// Sessions (revocable Postgres records), the sign-in attempt limit and role checks.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { one, only, pool, tx } from "./db.js";
import { ApiError, forbidden, unauthenticated } from "./http.js";
import { landing, type Role } from "./landing.js";
import { verifyPassword } from "./passwords.js";
import type { SessionUser, SignInAttemptRecord, UserRecord } from "./records.js";

const COOKIE = "swathdeck_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOCK_AFTER = 5;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
}

export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function tokenOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=") || null;
  }
  return null;
}

/** The signed-in user of this request only, or 401. */
export async function requireUser(req: IncomingMessage): Promise<SessionUser> {
  const token = tokenOf(req);
  if (!token) throw unauthenticated();
  const user = await one<SessionUser>(pool,
    `SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`, [digest(token), new Date()]);
  if (!user) throw unauthenticated();
  return user;
}

export function requireRole(user: UserRecord, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden();
}

export const isStaff = (user: UserRecord) => user.role === "principal_surveyor" || user.role === "launch_technician";

export function userJson(u: UserRecord): Record<string, unknown> {
  return { id: u.id, name: u.name, email: u.email, role: u.role, client_org_id: u.client_org_id ?? null, units: u.units };
}

async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)",
    [digest(token), userId, new Date(now), new Date(now + SESSION_MS)]);
  return token;
}

export async function refreshSession(tokenHash: string): Promise<void> {
  await pool.query("UPDATE sessions SET expires_at = $2 WHERE token_hash = $1", [tokenHash, new Date(Date.now() + SESSION_MS)]);
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await pool.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1", [tokenHash, new Date()]);
}

const invalidCredentials = () => new ApiError(401, "invalid_credentials", "Email or password is incorrect.");

function tooMany(lockedUntil: Date): ApiError {
  const retryAt = lockedUntil.toISOString().replace(/\.\d{3}Z$/, "Z");
  const wait = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  return new ApiError(429, "too_many_attempts", `Too many sign-in attempts. Try again after ${retryAt.slice(11, 16)} UTC.`,
    { retry_at: retryAt }, { "Retry-After": String(wait) });
}

/**
 * The sign-in attempt limit, applied one attempt at a time per normalised email (row lock):
 * five failures in a window lock the address for one window from the fifth, unknown addresses alike.
 */
export async function signIn(email: unknown, password: unknown, next: unknown): Promise<{ user: UserRecord; token: string; home: string }> {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) throw invalidCredentials();
  const address = email.trim().toLowerCase();
  const windowMs = config.signInWindowSeconds * 1000;
  return tx(async (db) => {
    await db.query("INSERT INTO sign_in_attempts (email) VALUES ($1) ON CONFLICT DO NOTHING", [address]);
    const attempt = await only<SignInAttemptRecord>(db, "SELECT * FROM sign_in_attempts WHERE email = $1 FOR UPDATE", [address]);
    const now = Date.now();
    if (attempt.locked_until && attempt.locked_until.getTime() > now) throw tooMany(attempt.locked_until);
    if (attempt.locked_until) {
      await db.query("UPDATE sign_in_attempts SET failures = 0, window_started_at = NULL, locked_until = NULL WHERE email = $1", [address]);
      attempt.failures = 0;
      attempt.window_started_at = null;
    }
    const user = await one<UserRecord>(db, "SELECT * FROM users WHERE lower(email) = $1", [address]);
    const ok = await verifyPassword(password, user?.password_hash ?? null);
    if (!ok || !user) {
      const fresh = !attempt.window_started_at || now - attempt.window_started_at.getTime() > windowMs;
      const failures = (fresh ? 0 : attempt.failures) + 1;
      const started = fresh ? new Date(now) : attempt.window_started_at;
      const lockedUntil = failures >= LOCK_AFTER ? new Date(Math.ceil((now + windowMs) / 1000) * 1000) : null;
      await db.query("UPDATE sign_in_attempts SET failures = $2, window_started_at = $3, locked_until = $4 WHERE email = $1",
        [address, failures, started, lockedUntil]);
      return { failed: true as const };
    }
    await db.query("UPDATE sign_in_attempts SET failures = 0, window_started_at = NULL, locked_until = NULL WHERE email = $1", [address]);
    const token = await createSession(db, user.id);
    return { failed: false as const, user, token, home: await landing(db, user, next) };
  }).then((result) => {
    if (result.failed) throw invalidCredentials();
    return result;
  });
}
