// Accounts, passwords, handles and sessions.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { one, pool, query, type Db } from "./db.ts";
import { fail, type Context } from "./http.ts";
import type { PersonRow } from "./access.ts";
import { newId } from "./projects.ts";
import { normalEmail } from "./validate.ts";

export const SESSION_COOKIE = "mg_session";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface UserRow extends PersonRow {
  password_hash: string;
}

export async function userByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  return one<UserRow>(db, "SELECT * FROM users WHERE email_key = $1", [normalEmail(email)]);
}

/** Local part in lower case, only a–z and 0–9; the smallest free number from 2 when taken. */
async function freeHandle(db: Db, email: string): Promise<string> {
  const local = email.slice(0, email.lastIndexOf("@")).toLowerCase().replace(/[^a-z0-9]/g, "");
  const taken = new Set(
    (await query<{ handle: string }>(db, "SELECT handle FROM users WHERE handle LIKE $1", [`${local}%`])).map((r) => r.handle),
  );
  if (!taken.has(local)) return local;
  for (let n = 2; ; n += 1) if (!taken.has(`${local}${n}`)) return `${local}${n}`;
}

export async function createUser(client: pg.PoolClient, email: string, displayName: string, password: string): Promise<UserRow> {
  const trimmed = email.trim();
  const passwordHash = await hashPassword(password);
  await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
  const handle = await freeHandle(client, trimmed);
  const row = await client.query<UserRow>(
    `INSERT INTO users (id, email, email_key, display_name, handle, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId(), trimmed, normalEmail(trimmed), displayName, handle, passwordHash],
  );
  return row.rows[0] as UserRow;
}

export async function openSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(db, "INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [digest(token), userId]);
  return token;
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await query(db, "DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function signedIn(ctx: Context): Promise<UserRow> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (!token) throw fail.unauthenticated();
  const user = await one<UserRow>(
    pool,
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [digest(token)],
  );
  if (!user) throw fail.unauthenticated();
  return user;
}
