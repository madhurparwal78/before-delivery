import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { JsonObject } from "../shared/json.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { fail } from "./errors.js";
import type { Ctx } from "./http.js";

/** Accounts: password hashing, confirmation codes and session cookies. */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const COOKIE = "jarful_session";
const SESSION_SECONDS = 30 * 24 * 3600;
export const MAX_CODE_ATTEMPTS = 5;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export const userJson = (user: SessionUser): JsonObject => ({ id: user.id, email: user.email, name: user.name });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [salt = "", hash = ""] = (stored ?? "00:00").split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length || 32);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return token;
}

export async function endSession(ctx: Ctx): Promise<void> {
  const token = ctx.cookie(COOKIE);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string | null): string {
  const flags = `Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? "; Secure" : ""}`;
  return token === null ? `${COOKIE}=; ${flags}; Max-Age=0` : `${COOKIE}=${token}; ${flags}; Max-Age=${SESSION_SECONDS}`;
}

async function currentUser(ctx: Ctx): Promise<SessionUser | null> {
  const token = ctx.cookie(COOKIE);
  if (!token) return null;
  const result = await db.query<SessionUser>(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND u.confirmed",
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireUser(ctx: Ctx): Promise<SessionUser> {
  return (await currentUser(ctx)) ?? fail("unauthenticated");
}
