import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";
import { Pool } from "pg";

/**
 * Accounts and sessions (DP-59, DP-60): scrypt password hashing, one active
 * six-digit code per address, HTTP-only session cookies.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return test.length === expected.length && timingSafeEqual(test, expected);
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** A six-digit sign-up code. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
}

export async function findUserByEmail(db: Pool, email: string): Promise<{ id: string; email: string; name: string; password_hash: string; confirmed: boolean } | null> {
  const r = await db.query("SELECT id, email, name, password_hash, confirmed FROM users WHERE email = $1", [email]);
  return r.rows.length > 0 ? (r.rows[0] as { id: string; email: string; name: string; password_hash: string; confirmed: boolean }) : null;
}

export async function findUserById(db: Pool, id: string): Promise<UserRow | null> {
  const r = await db.query("SELECT id, email, name FROM users WHERE id = $1", [id]);
  return r.rows.length > 0 ? (r.rows[0] as UserRow) : null;
}

export async function createSession(db: Pool, userId: string): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function sessionUser(db: Pool, token: string): Promise<UserRow | null> {
  const r = await db.query(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1",
    [token],
  );
  return r.rows.length > 0 ? (r.rows[0] as UserRow) : null;
}

export async function destroySession(db: Pool, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
