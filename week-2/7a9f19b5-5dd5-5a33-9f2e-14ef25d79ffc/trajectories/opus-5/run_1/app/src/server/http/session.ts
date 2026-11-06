import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { query, queryOne } from "../db/pool.js";
import type { DialMode, Role, TradeStatus, User } from "../../shared/types.js";

export const SESSION_COOKIE = "lf_session";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  trade_status: TradeStatus;
  dial_mode: DialMode;
}

type HeaderBag = Pick<IncomingMessage["headers"], "cookie">;

export function parseCookies(headers: HeaderBag): Record<string, string> {
  const header = headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name) out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export async function userFromHeaders(headers: HeaderBag): Promise<User | null> {
  const token = parseCookies(headers)[SESSION_COOKIE];
  if (!token) return null;
  const found = await queryOne<UserRow>(
    `SELECT u.id, u.email, u.name, u.role, u.trade_status, u.dial_mode
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token],
  );
  return found ? toUser(found) : null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    trade_status: row.trade_status,
    dial_mode: row.dial_mode,
  };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions (token, user_id) VALUES ($1,$2)", [token, userId]);
  return token;
}

export async function destroySession(headers: HeaderBag): Promise<void> {
  const token = parseCookies(headers)[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** The session cookie is HttpOnly and SameSite=Lax. */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
