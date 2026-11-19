import type { Request } from 'express';
import type { Sql } from './db.js';
import { newToken } from './ids.js';

export const SESSION_COOKIE = 'mg_session';

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; displayName: string; handle: string };
}

export async function userFromRequest(sql: Sql, req: Request): Promise<AuthedRequest['user']> {
  const token = readSessionCookie(req);
  if (!token) return undefined;
  const rows = await sql<{ id: string; email: string; display_name: string; handle: string }>`
    SELECT u.id, u.email, u.display_name, u.handle
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}`;
  return rows[0]
    ? { id: rows[0].id, email: rows[0].email, displayName: rows[0].display_name, handle: rows[0].handle }
    : undefined;
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(sql: Sql, userId: string): Promise<string> {
  const token = newToken(32);
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  return token;
}

export async function destroySession(sql: Sql, token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export function setSessionCookie(res: { setHeader: (k: string, v: string) => void }, token: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
