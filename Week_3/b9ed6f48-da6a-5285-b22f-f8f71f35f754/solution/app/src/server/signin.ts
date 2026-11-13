// Sign-in sessions live in PostgreSQL, so a cookie is valid on every instance and stays valid
// while PocketBase is unreachable (brief: Shared shapes › Session cookie; Services › PocketBase).

import { randomBytes } from "node:crypto";
import { one, pool } from "./db.js";
import { fail, type Context } from "./http.js";
import type { PbUser, Preferences, Role } from "./pocketbase.js";

const COOKIE = "sl_session";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  token: string;
  cachedPreferences: Preferences;
}

export async function startSession(user: PbUser): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sign_in_sessions (token, user_id, name, email, role) VALUES ($1, $2, $3, $4, $5)", [token, user.id, user.name, user.email, user.role]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function endSession(ctx: Context): Promise<void> {
  const token = ctx.cookies[COOKIE];
  if (token) await pool.query("DELETE FROM sign_in_sessions WHERE token = $1", [token]);
}

export async function currentUser(ctx: Context): Promise<SessionUser | null> {
  const token = ctx.cookies[COOKIE];
  if (!token) return null;
  const row = await one<{ user_id: string; name: string; email: string; role: Role; preferences: Preferences }>(
    pool,
    "SELECT user_id, name, email, role, preferences FROM sign_in_sessions WHERE token = $1",
    [token],
  );
  return row ? { id: row.user_id, name: row.name, email: row.email, role: row.role, token, cachedPreferences: row.preferences } : null;
}

export async function requireUser(ctx: Context): Promise<SessionUser> {
  const user = await currentUser(ctx);
  if (!user) throw fail.unauthenticated();
  return user;
}

/** 401, then 403 for a role outside `roles`. */
export async function requireRole(ctx: Context, roles: Role[]): Promise<SessionUser> {
  const user = await requireUser(ctx);
  if (!roles.includes(user.role)) throw fail.forbidden();
  return user;
}

export async function cachePreferences(token: string, preferences: Preferences): Promise<void> {
  await pool.query("UPDATE sign_in_sessions SET preferences = $2 WHERE token = $1", [token, JSON.stringify(preferences)]);
}

export const isStaff = (user: SessionUser | null) => user !== null && user.role !== "visitor";
