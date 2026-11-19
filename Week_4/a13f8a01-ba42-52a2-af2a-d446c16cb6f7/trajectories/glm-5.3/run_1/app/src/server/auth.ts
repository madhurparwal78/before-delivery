import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Database } from "./db.js";
import type { UserRow } from "./domain.js";

export const SESSION_COOKIE = "ashlar_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 64);
  const target = Buffer.from(hash, "hex");
  return check.length === target.length && timingSafeEqual(check, target);
}

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

export async function createSession(db: Database, userId: string): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function userFromSession(db: Database, token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const res = await db.query<UserRow>(
    "SELECT u.id, u.handle, u.email, u.password_hash, u.verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1",
    [token],
  );
  return res[0] ?? null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
