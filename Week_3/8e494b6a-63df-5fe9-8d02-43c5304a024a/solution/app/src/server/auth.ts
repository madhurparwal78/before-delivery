// Passwords (salted scrypt), session cookies and API keys (stored only as SHA-256 hashes).
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db";
import { now } from "./clock";
import { errors } from "./errors";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number }) => Promise<Buffer>;
const SCRYPT_N = 16384;
const KEY_LENGTH = 32;
export const COOKIE_NAME = "spoor_session";
const SESSION_MAX_AGE_S = 30 * 24 * 3600;

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, n, salt, hash] = (stored ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scryptAsync(password, Buffer.from(salt ?? "", "base64"), expected.length, { N: Number(n) });
  return timingSafeEqual(actual, expected) && stored !== null;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, user_id, created_ms) VALUES ($1, $2, $3)", [sha256Hex(token), userId, now()]);
  return token;
}

export const sessionCookie = (token: string): string =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}`;
export const clearedCookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export interface UserPrincipal {
  kind: "user";
  id: number;
  username: string;
  timeZone: string;
  currentSpaceId: number | null;
  sessionHash: string;
}

export type KeyAction = "read" | "upload" | "manage";

export interface KeyPrincipal {
  kind: "key";
  id: number;
  name: string;
  spaceId: number;
  pattern: string;
  actions: KeyAction[];
}

export type Principal = UserPrincipal | KeyPrincipal;

export async function userFromSession(token: string | null): Promise<UserPrincipal | null> {
  if (!token) return null;
  const sessionHash = sha256Hex(token);
  const { rows } = await pool.query<{ id: number; username: string; time_zone: string; current_space_id: number | null }>(
    "SELECT u.id, u.username, u.time_zone, u.current_space_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [sessionHash],
  );
  const row = rows[0];
  return row ? { kind: "user", id: row.id, username: row.username, timeZone: row.time_zone, currentSpaceId: row.current_space_id, sessionHash } : null;
}

export async function endSession(token: string | null): Promise<void> {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
}

export async function keyFromBearer(value: string): Promise<KeyPrincipal> {
  const { rows } = await pool.query<{
    id: number; name: string; space_id: number; stream_pattern: string; actions: KeyAction[]; expires_ms: number | null; revoked: boolean;
  }>("SELECT id, name, space_id, stream_pattern, actions, expires_ms, revoked FROM api_keys WHERE key_hash = $1", [sha256Hex(value)]);
  const row = rows[0];
  if (!row) throw errors.keyInvalid();
  if (row.revoked) throw errors.keyRevoked();
  if (row.expires_ms !== null && now() >= row.expires_ms) throw errors.keyExpired();
  return { kind: "key", id: row.id, name: row.name, spaceId: row.space_id, pattern: row.stream_pattern, actions: row.actions };
}

/** `*` stands for any run of characters; the pattern must match the whole stream name. */
export function patternMatches(pattern: string, name: string): boolean {
  const source = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(name);
}
