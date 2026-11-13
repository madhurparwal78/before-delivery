import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Session } from "../shared/types.js";
import { nowIso } from "./clock.js";
import { db } from "./db.js";
import type { Account } from "./http.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const COOKIE = "interval_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = await scryptAsync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(key, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export function tokenOf(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=") || null;
  }
  return null;
}

export async function accountOf(req: IncomingMessage): Promise<Account | null> {
  const token = tokenOf(req);
  if (!token) return null;
  const found = await db.query(
    "SELECT a.id, a.role, a.email, a.display_name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1",
    [digest(token)],
  );
  const r = found.rows[0];
  return r ? { id: r.id as string, role: r.role as Account["role"], email: r.email as string, displayName: r.display_name as string } : null;
}

export async function openSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, account_id, created_at) VALUES ($1, $2, $3)", [digest(token), accountId, nowIso()]);
  return token;
}

export async function closeSession(token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

export const sessionBody = (a: Account): Session => ({ role: a.role, email: a.email, displayName: a.displayName, accountId: a.id });
export const sessionCookie = (token: string): string => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
