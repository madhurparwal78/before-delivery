// Passwords, sessions and roles.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Role, User } from "../shared/api";
import { pool } from "./db";
import { forbidden } from "./http";

const SESSION_COOKIE = "shelfmark_session";
const SESSION_DAYS = 14;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface UserRow {
  id: number;
  name: string;
  role: Role;
  email: string;
  member_number: string | null;
  kb_account_id: string | null;
}

export function userOut(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, member_number: row.member_number };
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [tokenHash(token), userId, SESSION_DAYS],
  );
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function authenticate(req: IncomingMessage): Promise<User | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const found = await pool.query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  const row = found.rows[0];
  return row ? userOut(row) : null;
}

export const isStaff = (user: User) => user.role === "owner" || user.role === "tech";

/** Throws the 403 unless the user has one of the roles. */
export function allow(user: User, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden();
}
