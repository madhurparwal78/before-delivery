import { pool } from './db.js';
import { appNow } from './app-clock.js';
import { hashToken, sessionToken } from './emails.js';

const SESSION_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const COOKIE_NAME = 'stillhour_session';

export async function createSession(email: string): Promise<string> {
  const token = sessionToken();
  const now = await appNow();
  await pool.query(
    'INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2,$3,$4)',
    [hashToken(token), email, new Date(now + SESSION_DAYS_MS), new Date(now)],
  );
  return token;
}

export async function sessionEmail(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const now = await appNow();
  const r = await pool.query<{ email: string }>(
    'SELECT email FROM sessions WHERE token_hash = $1 AND expires_at > $2',
    [hashToken(token), new Date(now)],
  );
  return r.rows[0]?.email ?? null;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export function cookieHeader(token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export const SESSION_MAX_AGE = SESSION_DAYS_MS / 1000;
