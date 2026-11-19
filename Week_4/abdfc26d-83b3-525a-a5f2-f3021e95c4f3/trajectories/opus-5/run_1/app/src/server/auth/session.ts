import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

export const SESSION_COOKIE = 'py_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [id, userId, SESSION_TTL_SECONDS],
  );
  return id;
}

export async function userIdForSession(sessionId: string): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    'SELECT user_id FROM auth_sessions WHERE id = $1 AND expires_at > now()',
    [sessionId],
  );
  return result.rows[0]?.user_id ?? null;
}

export async function destroySession(sessionId: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE id = $1', [sessionId]);
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
