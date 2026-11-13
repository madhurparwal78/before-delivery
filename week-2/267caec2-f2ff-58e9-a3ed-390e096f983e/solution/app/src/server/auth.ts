import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type Db, one, pool } from "./db.js";
import { refuse } from "./errors.js";
import { type ApiRequest, SESSION_COOKIE } from "./http.js";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export type Role = "director" | "juror" | "studio";

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  studio_id: string | null;
  studio_name: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const USER_SELECT = `
  SELECT u.id, u.role, u.name, u.email, u.studio_id, s.name AS studio_name
  FROM users u LEFT JOIN studios s ON s.id = u.studio_id`;

/** The signed-in user, or 401 (brief: Error precedence step 2). */
export async function requireUser(req: ApiRequest): Promise<SessionUser> {
  const user = await optionalUser(req);
  if (!user) throw refuse("unauthenticated");
  return user;
}

/** The signed-in user if any, for endpoints anyone may call. */
export async function optionalUser(req: ApiRequest): Promise<SessionUser | null> {
  if (!req.sessionToken) return null;
  return one<SessionUser>(pool, `${USER_SELECT} JOIN sessions x ON x.user_id = u.id WHERE x.token_hash = $1`,
    [tokenHash(req.sessionToken)]);
}

/** 403 for the wrong role (brief: Error precedence step 4). */
export function requireRole(user: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw refuse("forbidden");
}

export async function signIn(email: string, password: string): Promise<{ user: SessionUser; cookie: string } | null> {
  const row = await one<SessionUser & { password_hash: string }>(pool,
    `SELECT u.id, u.role, u.name, u.email, u.studio_id, s.name AS studio_name, u.password_hash
     FROM users u LEFT JOIN studios s ON s.id = u.studio_id WHERE lower(u.email) = lower($1)`, [email]);
  if (!row || !(await passwordMatches(password, row.password_hash))) return null;
  const { password_hash: _, ...user } = row;
  return { user, cookie: await startSession(pool, user.id) };
}

export async function startSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export async function endSession(token: string): Promise<string> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
