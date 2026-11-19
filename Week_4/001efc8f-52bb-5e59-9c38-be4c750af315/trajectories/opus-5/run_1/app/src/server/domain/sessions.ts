import type { IncomingMessage } from 'node:http';
import { query, queryOne } from '../db';
import { nowDate } from '../clock';
import { newToken } from '../passwords';
import type { SessionUser } from '../http/context';

const COOKIE_NAME = 'rimewire_session';

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [token, userId, nowDate()]);
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = $2 WHERE token = $1 AND revoked_at IS NULL', [token, nowDate()]);
}

export async function revokeSessionsOf(userId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, nowDate()]);
}

export async function resolveSession(req: IncomingMessage): Promise<SessionUser | null> {
  const token = cookieToken(req);
  if (token === null) return null;
  return queryOne<SessionUser>(
    `SELECT u.id, u.workspace_id, u.name, u.handle, u.email, u.role, u.status, s.token
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.revoked_at IS NULL AND u.status = 'active'`,
    [token],
  );
}
