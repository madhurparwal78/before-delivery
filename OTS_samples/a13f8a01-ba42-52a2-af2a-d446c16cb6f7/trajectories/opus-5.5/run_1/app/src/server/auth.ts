import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "../shared/types";
import { one, pool, type Queryable } from "./db";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export interface UserRow {
  id: string;
  handle: string;
  email: string;
  verified: boolean;
}

export const sessionCookieName = "ashlar_session";

export function toUser(row: UserRow): User {
  return { id: row.id, handle: row.handle, email: row.email, verified: row.verified };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(length = 10): string {
  const bytes = randomBytes(length);
  let id = "";
  for (const byte of bytes) id += idAlphabet[byte % idAlphabet.length];
  return id;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const derived = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(derived, expected);
}

export async function startSession(db: Queryable, userId: string): Promise<string> {
  const token = randomToken();
  await db.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha256Hex(token), userId]);
  return `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function endSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
}

export async function userForSession(token: string): Promise<UserRow | null> {
  const row = await one<UserRow>(
    pool,
    "SELECT u.id, u.handle, u.email, u.verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [sha256Hex(token)],
  );
  return row ?? null;
}
