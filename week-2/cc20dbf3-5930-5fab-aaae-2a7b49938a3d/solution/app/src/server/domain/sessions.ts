// Sign-in: scrypt password hashes and opaque session tokens. Only a hash of each token is stored, in
// PostgreSQL, so a session issued by any copy of the server is valid on every copy.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Role, User } from "../../shared/api.js";
import { pool } from "../db.js";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const SESSION_DAYS = 30;
const SESSION_COOKIE = "shedline_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt = "", expected = ""] = stored.split("$");
  const actual = await derive(password, Buffer.from(salt, "base64url"), 32);
  const wanted = Buffer.from(expected, "base64url");
  return wanted.length === actual.length && timingSafeEqual(actual, wanted);
}

const DECOY_HASH = await hashPassword(randomBytes(12).toString("base64url"));

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Returns the signed-in user and a new session token, or null when the email or password is wrong. */
export async function signIn(email: string, password: string, now: Date): Promise<{ user: User; token: string } | null> {
  const found = await pool.query<User & { password_hash: string }>(
    "SELECT id, name, role, password_hash FROM person WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  const person = found.rows[0];
  const matches = await passwordMatches(password, person?.password_hash ?? DECOY_HASH);
  if (!person || !matches) return null;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await pool.query("INSERT INTO session (token_hash, person_id, expires_at) VALUES ($1, $2, $3)", [tokenHash(token), person.id, expires]);
  return { user: { id: person.id, name: person.name, role: person.role }, token };
}

export async function userForToken(token: string, now: Date): Promise<User | null> {
  const found = await pool.query<{ id: string; name: string; role: Role }>(
    `SELECT p.id, p.name, p.role FROM session s JOIN person p ON p.id = s.person_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash(token), now],
  );
  return found.rows[0] ?? null;
}

export async function signOut(token: string): Promise<void> {
  await pool.query("DELETE FROM session WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function tokenFromCookieHeader(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
