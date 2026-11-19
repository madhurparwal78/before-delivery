import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";

export interface SessionUser {
  id: string;
  username: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const calc = createHash("sha256").update(salt + password).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = "loz_session";

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function sessionUser(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const res = await db.query(
    "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1",
    [token],
  );
  const row = res.rows[0];
  return row ? { id: row.id, username: row.username } : null;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** A sliding one-minute window counter for rate limits. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private limit: number) {}

  take(key: string, now: number): { allowed: boolean; retryAfter: number } {
    const windowStart = now - 60000;
    const list = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (list.length >= this.limit) {
      const retryAfter = Math.ceil((list[0] + 60000 - now) / 1000);
      this.hits.set(key, list);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, retryAfter: 0 };
  }
}

export function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function usernameValid(username: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

export function passwordValid(password: string): boolean {
  return typeof password === "string" && password.length >= 8;
}
