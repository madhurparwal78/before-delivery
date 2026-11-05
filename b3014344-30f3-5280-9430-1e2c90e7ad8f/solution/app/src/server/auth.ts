import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { one, query, type Db } from "./db";
import { cookies, HttpError } from "./http";
import { COPY } from "../shared/copy";
import type { Role, User } from "../shared/domain";

const SESSION_COOKIE = "pampero_session";
const SESSION_DAYS = 30;
const derive = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Passwords are stored only as salted scrypt hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A visitor's session: `ownerKey` stays the same across sign-in, so quoted orders stay theirs. */
export interface Session {
  tokenHash: string;
  ownerKey: string;
  user: User | null;
}

interface UserRow {
  [key: string]: unknown;
  id: string;
  name: string;
  email: string;
  role: Role;
  account_id: string | null;
}

export function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, accountId: row.account_id };
}

export async function loadSession(req: IncomingMessage): Promise<Session | null> {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const hash = tokenHash(token);
  const row = await one<UserRow & { owner_key: string; user_id: string | null }>(
    `SELECT s.owner_key, s.user_id, u.id, u.name, u.email, u.role, u.account_id
     FROM sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash],
  );
  if (!row) return null;
  return { tokenHash: hash, ownerKey: row.owner_key, user: row.user_id ? toUser(row) : null };
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Starts an anonymous session (a visitor who quotes before signing in). */
export async function anonymousSession(): Promise<{ session: Session; token: string }> {
  const token = newToken();
  const session: Session = { tokenHash: tokenHash(token), ownerKey: randomUUID(), user: null };
  await query(`INSERT INTO sessions (token_hash, owner_key, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
    session.tokenHash,
    session.ownerKey,
  ]);
  return { session, token };
}

/** Signs a user in, rotating the token while keeping the visitor's owner key. */
export async function signIn(db: Db | null, userId: string, previous: Session | null): Promise<string> {
  const token = newToken();
  const ownerKey = previous?.ownerKey ?? randomUUID();
  const run = async (sql: string, params: unknown[]) => (db ? db.query(sql, params) : query(sql, params));
  if (previous) await run("DELETE FROM sessions WHERE token_hash = $1", [previous.tokenHash]);
  await run(`INSERT INTO sessions (token_hash, owner_key, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`, [
    tokenHash(token),
    ownerKey,
    userId,
  ]);
  return token;
}

export async function signOut(session: Session): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [session.tokenHash]);
}

export async function checkCredentials(email: unknown, password: unknown): Promise<User> {
  const refused = new HttpError(401, "invalid_credentials", COPY.signInError);
  if (typeof email !== "string" || typeof password !== "string") throw refused;
  const row = await one<UserRow & { password_hash: string }>(
    "SELECT id, name, email, role, account_id, password_hash FROM users WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  if (!row || !(await verifyPassword(password, row.password_hash))) throw refused;
  return toUser(row);
}

export async function emailTaken(email: string, db?: Db): Promise<boolean> {
  const sql = "SELECT 1 FROM users WHERE lower(email) = lower($1)";
  const found = db ? (await db.query(sql, [email])).rows : await query(sql, [email]);
  return found.length > 0;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());
}
