import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SessionUser } from '../../shared/api.js';
import { query, queryOne } from '../db/pool.js';
import { toSessionUser, type UserRow } from '../store/people.js';

export const SESSION_COOKIE = 'rl_session';

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function userForToken(token: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.org_id, u.initials, u.phone, u.home_city, u.pay_rate_cents
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  return row ? toSessionUser(row) : null;
}
