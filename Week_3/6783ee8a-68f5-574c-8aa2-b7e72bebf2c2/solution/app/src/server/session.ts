import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { User } from "../shared/api";
import { pool, queryOne } from "./db";
import type { Db } from "./db";

const SESSION_COOKIE = "bp_session";
const SESSION_DAYS = 30;
const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export const newToken = (): string => randomBytes(24).toString("base64url");
export const newId = (prefix: string): string => `${prefix}${randomBytes(9).toString("base64url")}`;
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scrypt(password, salt, 32)).toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(await scrypt(password, Buffer.from(salt, "hex"), expected.length), expected);
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function openSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [
    hashToken(token),
    userId,
    SESSION_DAYS,
  ]);
  return token;
}

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export const sessionToken = (req: IncomingMessage): string | null => cookieValue(req, SESSION_COOKIE);

export async function userFromRequest(req: IncomingMessage): Promise<User | null> {
  const token = sessionToken(req);
  if (!token) return null;
  return queryOne<User>(
    pool,
    `SELECT u.id, u.email, u.display_name, u.verified FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
}
