// Sign-in sessions: a random token in the HttpOnly `bellroll_session` cookie; only its SHA-256 is stored.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "../../shared/api.js";
import { nowSecond } from "../clock.js";
import { pool, query } from "../db/pool.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const SESSION_COOKIE = "bellroll_session";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionToken(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

const USER_COLUMNS = "u.id, u.name, u.email, u.role, u.family_id, u.school_id";

export async function currentUser(cookieHeader: string | undefined): Promise<User | null> {
  const token = sessionToken(cookieHeader);
  if (token === null) return null;
  const [user] = await query<User>(pool,
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [tokenHash(token)]);
  return user ?? null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":").map((part) => Buffer.from(part, "base64url"));
  const candidate = await scryptAsync(password, salt, hash.length);
  return timingSafeEqual(candidate, hash);
}

/** Checks the credentials and opens a session; returns the user and the Set-Cookie value, or null. */
export async function signIn(email: string, password: string): Promise<{ user: User; cookie: string } | null> {
  const [row] = await query<User & { password_hash: string }>(pool,
    `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = lower($1)`, [email]);
  if (row === undefined || !(await passwordMatches(password, row.password_hash))) return null;
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
    [tokenHash(token), row.id, nowSecond()]);
  const { password_hash: _hash, ...user } = row;
  return { user, cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` };
}

export async function signOut(cookieHeader: string | undefined): Promise<string> {
  const token = sessionToken(cookieHeader);
  if (token !== null) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
