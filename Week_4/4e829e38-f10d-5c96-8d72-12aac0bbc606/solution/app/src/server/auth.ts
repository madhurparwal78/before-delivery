import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { Queryable } from "./db.js";
import { now } from "./clock.js";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function startSession(db: Queryable, personId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)", [token, personId, await now(db)]);
  return token;
}

export async function personForToken(db: Queryable, token: string | null): Promise<string | null> {
  if (!token) return null;
  const { rows } = await db.query<{ person_id: string }>("SELECT person_id FROM sessions WHERE token = $1", [token]);
  return rows.length ? rows[0].person_id : null;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
