// Local accounts: scrypt passwords and the `spur_session` cookie (HttpOnly; SameSite=Lax, no Secure).
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { db, type Queryable, type Tx } from "./db.ts";
import { now } from "./clock.ts";
import type { UserRow } from "./access.ts";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SESSION_COOKIE = "spur_session";
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

const DUMMY_HASH = `${"00".repeat(16)}:${"00".repeat(KEY_LENGTH)}`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [saltHex, keyHex] = (stored ?? DUMMY_HASH).split(":");
  const expected = Buffer.from(keyHex ?? "", "hex");
  const actual = await scrypt(password, Buffer.from(saltHex ?? "", "hex"), KEY_LENGTH);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(q: Queryable | Tx, userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await q.q("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, now()]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await db.q("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionToken(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function userForToken(token: string | undefined): Promise<UserRow | undefined> {
  if (token === undefined || token === "") return undefined;
  return db.maybe<UserRow>(
    "SELECT u.id, u.username, u.time_zone FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [tokenHash(token)],
  );
}

export function publicUser(user: UserRow): { id: number; username: string; time_zone: string } {
  return { id: user.id, username: user.username, time_zone: user.time_zone };
}
