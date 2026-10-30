import { query } from '../db.js';
import { newToken } from './links.js';

export const SESSION_COOKIE = 'stillhour_session';
export const SESSION_MAX_AGE_SECONDS = 2_592_000;

export async function createSession(email: string, at: Date): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await query('insert into sessions (token, email, created_at, expires_at) values ($1, $2, $3, $4)', [
    token,
    email,
    at,
    expiresAt,
  ]);
  return token;
}

export async function sessionEmail(token: string, at: Date): Promise<string | null> {
  const result = await query<{ email: string; expires_at: Date }>(
    'select email, expires_at from sessions where token = $1',
    [token],
  );
  const session = result.rows[0];
  if (!session) return null;
  return session.expires_at.getTime() > at.getTime() ? session.email : null;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}
