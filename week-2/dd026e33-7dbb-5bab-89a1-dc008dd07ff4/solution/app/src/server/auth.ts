// Sessions and roles (brief: Business rules › Sessions and staff access, Roles). Sessions live in
// Postgres; the fixed lifetime and the revoke rule are decided in resolveSession only.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { User } from "../shared/api.js";
import type { Role } from "../shared/domain.js";
import { config } from "./config.js";
import { one, pool, type Db } from "./db.js";
import { accessRevoked, forbidden, sessionExpired, unauthenticated } from "./errors.js";

const SESSION_COOKIE = "lacquer_session";

export interface SessionUser extends User {
  sessionId: string;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

/** The live session behind the request's cookie, or the brief's 401 in its published order. */
export async function resolveSession(req: IncomingMessage): Promise<SessionUser> {
  const token = cookieToken(req);
  if (!token) throw unauthenticated();
  const row = await one<{
    session_id: string;
    end_reason: string | null;
    expired: boolean;
    id: string;
    name: string;
    email: string;
    role: Role;
  }>(
    pool,
    `SELECT s.id AS session_id, s.end_reason, clock_timestamp() >= s.expires_at AS expired,
            u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionKey(token)],
  );
  if (!row) throw unauthenticated();
  if (row.end_reason === "revoked") throw accessRevoked();
  if (row.expired) throw sessionExpired();
  if (row.end_reason === "signed_out") throw unauthenticated();
  return { id: row.id, name: row.name, email: row.email, role: row.role, sessionId: row.session_id };
}

/** Starts a session for verified credentials; returns the user and the cookie token, or null. */
export async function signIn(email: string, password: string): Promise<{ user: User; token: string } | null> {
  const row = await one<{ id: string; name: string; email: string; role: Role; password_hash: string; active: boolean }>(
    pool,
    "SELECT id, name, email, role, password_hash, active FROM users WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  if (!row || !row.active || !(await passwordMatches(password, row.password_hash))) return null;
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `WITH started AS (
       INSERT INTO sessions (id, user_id, signed_in_at, expires_at)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + make_interval(secs => $3))
       RETURNING signed_in_at)
     UPDATE users SET last_sign_in_at = (SELECT signed_in_at FROM started) WHERE id = $2`,
    [sessionKey(token), row.id, config.timers.sessionLifetimeSeconds],
  );
  return { user: { id: row.id, name: row.name, email: row.email, role: row.role }, token };
}

export async function signOut(db: Db, sessionId: string): Promise<void> {
  await db.query("UPDATE sessions SET ended_at = clock_timestamp(), end_reason = 'signed_out' WHERE id = $1 AND ended_at IS NULL", [
    sessionId,
  ]);
}

/** Ends every session a member holds; their cookies answer access_revoked from now on. */
export async function endSessionsForRevoke(db: Db, userId: string): Promise<void> {
  await db.query(
    "UPDATE sessions SET ended_at = coalesce(ended_at, clock_timestamp()), end_reason = 'revoked' WHERE user_id = $1 AND end_reason IS DISTINCT FROM 'signed_out'",
    [userId],
  );
}

/** The cookie outlives the session on purpose: the server, not the browser, decides that it ended. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The role table (brief: Business rules › Roles): anything not granted answers 403. */
export function requireRole(user: User, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden();
}

function isOwner(user: User): boolean {
  return user.role === "owner";
}

export function requireStaff(user: User): void {
  if (isOwner(user)) throw forbidden();
}
