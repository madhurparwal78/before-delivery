// Client (gw_session) and founder (gw_studio) sessions, stored hashed in Postgres.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { one, pool, type Db } from "../db.js";
import { ApiError } from "../errors.js";
import type { Context } from "../http.js";

export const CLIENT_COOKIE = "gw_session";
export const STUDIO_COOKIE = "gw_studio";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scryptAsync(password, salt, 32)).toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  return timingSafeEqual(await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length), expected);
}

export async function createSession(db: Db, kind: "client" | "studio", brandId: string | null, email: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, kind, brand_id, email) VALUES ($1, $2, $3, $4)", [hashToken(token), kind, brandId, email]);
  return token;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/** The signed-in brand's id, or null when the cookie carries no live client session. */
export async function clientBrand(cookies: Record<string, string>): Promise<string | null> {
  const token = cookies[CLIENT_COOKIE];
  if (!token) return null;
  const row = await one<{ brand_id: string }>(pool, "SELECT brand_id FROM sessions WHERE token_hash = $1 AND kind = 'client'", [hashToken(token)]);
  return row?.brand_id ?? null;
}

export async function requireBrand(ctx: Context): Promise<string> {
  const brandId = await clientBrand(ctx.cookies);
  if (!brandId) throw new ApiError("unauthenticated");
  return brandId;
}

export async function requireFounder(ctx: Context): Promise<void> {
  const token = ctx.cookies[STUDIO_COOKIE];
  const row = token ? await one(pool, "SELECT 1 FROM sessions WHERE token_hash = $1 AND kind = 'studio'", [hashToken(token)]) : null;
  if (!row) throw new ApiError("unauthenticated");
}
