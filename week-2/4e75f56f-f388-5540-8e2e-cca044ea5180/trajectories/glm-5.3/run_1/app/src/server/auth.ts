import type { Request, Response } from "express";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "./db.js";
import { newToken } from "./ids.js";
import { err, forbidden, unauthenticated } from "./errors.js";
import type { Role } from "./domain.js";

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
  clinic_name: string | null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const SESSION_COOKIE = "ob_session";

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function accountFromRequest(req: Request): Promise<Account | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query<Account & { token: string }>(
    `SELECT a.id, a.name, a.email, a.role, a.clinic_name
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token = $1`,
    [token]
  );
  return rows[0] ?? null;
}

export async function requireAccount(req: Request): Promise<Account> {
  const account = await accountFromRequest(req);
  if (!account) throw unauthenticated();
  return account;
}

export async function requireRole(req: Request, ...roles: Role[]): Promise<Account> {
  const account = await accountFromRequest(req);
  if (!account) throw unauthenticated();
  if (!roles.includes(account.role)) throw forbidden();
  return account;
}

/** Buyer roles are the only roles that can hold, buy or attend. */
export const BUYER_ROLES: Role[] = ["practitioner", "clinic"];

export async function requireBuyer(req: Request): Promise<Account> {
  const account = await accountFromRequest(req);
  if (!account) throw unauthenticated();
  if (!BUYER_ROLES.includes(account.role)) throw forbidden();
  return account;
}

export async function createSession(accountId: string): Promise<string> {
  const token = newToken();
  await query("INSERT INTO sessions (token, account_id) VALUES ($1, $2)", [token, accountId]);
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function destroySession(req: Request): Promise<void> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export function validEmail(email: unknown): boolean {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function fieldError(field: string, message: string): { fields: Record<string, string> } {
  return { fields: { [field]: message } };
}

export { err };
