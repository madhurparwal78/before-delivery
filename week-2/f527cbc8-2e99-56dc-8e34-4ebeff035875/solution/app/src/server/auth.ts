// Sign-in with scrypt password hashes, Postgres-backed sessions that work on every instance, and scoped API tokens
// stored only as hashes (brief: Session; API tokens).
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { now, plusSeconds } from "./clock.js";
import { type Queryable, db } from "./db.js";

export type Role = "farrier" | "apprentice" | "owner" | "barn_manager";
type TokenScope = "read_only" | "billing";

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  barn_id: string | null;
}

/** The signed-in caller: a session's user, or the farrier acting through an API token. */
export interface Caller extends User {
  token: { id: string; scope: TokenScope } | null;
  sessionHash: string | null;
}

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const COOKIE = "clinchline_session";
/** The browser keeps the cookie this long; the session itself lasts until sign-out (brief: Server boundary). */
const COOKIE_SECONDS = 30 * 86_400;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt = "", hash = ""] = stored.split("$");
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export const secretHash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const USER_COLUMNS = "u.id, u.name, u.email, u.role, u.barn_id";

/** Checks the credentials and opens a session; null when the email or password is wrong. */
export async function signIn(email: string, password: string): Promise<{ user: User; cookie: string } | null> {
  const { rows } = await db.query<User & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = lower($1)`,
    [email],
  );
  const found = rows[0];
  if (!found || !(await passwordMatches(password, found.password_hash))) return null;
  const token = randomBytes(32).toString("base64url");
  await db.query(`INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)`, [secretHash(token), found.id, new Date(now())]);
  const { password_hash: _hash, ...user } = found;
  return { user, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}` };
}

function cookieToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export async function sessionValid(sessionHash: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [sessionHash]);
  return Boolean(rowCount);
}

/** The caller behind the request's session cookie or Bearer token, or null. */
export async function caller(req: IncomingMessage): Promise<Caller | null> {
  const bearer = bearerToken(req);
  if (bearer !== null) {
    const { rows } = await db.query<User & { token_id: string; scope: TokenScope }>(
      `SELECT ${USER_COLUMNS}, t.id AS token_id, t.scope FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [secretHash(bearer)],
    );
    const found = rows[0];
    if (!found) return null;
    const { token_id, scope, ...user } = found;
    return { ...user, token: { id: token_id, scope }, sessionHash: null };
  }
  const token = cookieToken(req);
  if (!token) return null;
  const hash = secretHash(token);
  const { rows } = await db.query<User>(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [hash],
  );
  const found = rows[0];
  return found ? { ...found, token: null, sessionHash: hash } : null;
}

export async function signOut(caller: Caller): Promise<string> {
  if (caller.sessionHash) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [caller.sessionHash]);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** A new API token: `cl_` and 32 URL-safe random bytes; only its hash is stored. */
export async function issueToken(
  client: Queryable,
  userId: string,
  name: string,
  scope: TokenScope,
): Promise<{ id: string; token: string; createdAt: Date }> {
  const token = `cl_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const createdAt = new Date(now());
  await client.query(`INSERT INTO api_tokens (id, name, scope, token_hash, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    id,
    name,
    scope,
    secretHash(token),
    userId,
    createdAt,
  ]);
  return { id, token, createdAt };
}
