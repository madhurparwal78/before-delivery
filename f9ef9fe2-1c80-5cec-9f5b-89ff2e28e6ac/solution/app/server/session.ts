import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { promisify } from "node:util";
import { pool } from "./db.js";
import type { User } from "./domain.js";
import { refuse } from "./errors.js";

const scryptAsync = promisify<string, Buffer, number, Buffer>(scrypt);
const KEY_LENGTH = 64;
const SESSION_DAYS = 14;
const COOKIE = "pl_session";

/** Slow salted hash: scrypt with a 16-byte random salt, stored as `scrypt$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, "base64");
  const derived = Buffer.from(await scryptAsync(password, Buffer.from(salt, "base64"), expected.length));
  return timingSafeEqual(derived, expected);
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

const USER_COLUMNS = "u.id, u.name, u.email, u.role, u.kitchen_id, u.member_id";

export async function signIn(email: string, password: string, now: Date): Promise<{ user: User; cookie: string }> {
  const found = await pool.query<User & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = lower($1)`,
    [email],
  );
  const row = found.rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) throw refuse.invalidCredentials();
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
    tokenHash(token),
    row.id,
    now,
    new Date(now.getTime() + SESSION_DAYS * 86_400_000),
  ]);
  const { password_hash: _, ...user } = row;
  return {
    user,
    cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`,
  };
}

function cookieToken(headers: IncomingHttpHeaders): string | null {
  for (const part of (headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

/** The signed-in user, or 401 unauthenticated. */
export async function currentUser(headers: IncomingHttpHeaders, now: Date): Promise<User> {
  const token = cookieToken(headers);
  if (!token) throw refuse.unauthenticated();
  const found = await pool.query<User>(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash(token), now],
  );
  const user = found.rows[0];
  if (!user) throw refuse.unauthenticated();
  return user;
}

export async function signOut(headers: IncomingHttpHeaders): Promise<string> {
  const token = cookieToken(headers);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
