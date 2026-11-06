/** Sessions: sign-in, sign-out and the session cookie. */

import type { Pool } from "../db/pool.js";
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { hashPasscode } from "../db/seed.js";

export const SESSION_COOKIE = "pw_session";

export interface SessionUser {
  id: string;
  handle: string;
  display_name: string;
  sound_on: boolean;
}

export async function signIn(pool: Pool, handle: string, passcode: string): Promise<{ user: SessionUser; token: string } | null> {
  const res = await pool.query<SessionUser & { passcode_hash: string }>(
    "SELECT id, handle, display_name, sound_on, passcode_hash FROM users WHERE handle = $1",
    [handle]
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  if (row.passcode_hash !== hashPasscode(passcode)) return null;
  const token = randomBytes(24).toString("hex");
  await pool.query("INSERT INTO sessions (token, user_id) VALUES ($1,$2)", [token, row.id]);
  return { user: { id: row.id, handle: row.handle, display_name: row.display_name, sound_on: row.sound_on }, token };
}

export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await pool.query("INSERT INTO sessions (token, user_id) VALUES ($1,$2)", [token, userId]);
  return token;
}

export async function signOut(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function sessionUser(pool: Pool, req: Request): Promise<SessionUser | null> {
  const token = readCookie(req);
  if (token === null) return null;
  const res = await pool.query<SessionUser>(
    `SELECT u.id, u.handle, u.display_name, u.sound_on FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  return res.rows[0] ?? null;
}

export function sessionToken(req: Request): string | null {
  return readCookie(req);
}

function readCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      return rest.join("=");
    }
  }
  return null;
}

export function cookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
