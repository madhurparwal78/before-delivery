import type { Config } from './config.js';
import { query } from './db.js';
import { newId, verifyPassword, hashPassword } from './store.js';


// Sessions: HTTP-only cookie, fixed lifetime in real seconds, shared by every
// instance on the database.

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  country: string;
  role: 'rider' | 'fitter';
  landing: '/orders' | '/desk';
}

export const SESSION_COOKIE = 'ommezwaai_session';

export async function createSession(config: Config, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newId('sess');
  const expiresAt = new Date(Date.now() + config.sessionSeconds * 1000);
  await query(config, `insert into sessions (token, user_id, expires_at) values ($1, $2, $3)`, [token, userId, expiresAt]);
  return { token, expiresAt };
}

export async function sessionUser(config: Config, cookies: Record<string, string>): Promise<SessionUser | null> {
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const r = await query<{ id: string; email: string; name: string; country: string; role: 'rider' | 'fitter' }>(
    config,
    `select u.id, u.email, u.name, u.country, u.role from sessions s join users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { ...row, landing: row.role === 'fitter' ? '/desk' : '/orders' };
}

export async function destroySession(config: Config, cookies: Record<string, string>): Promise<void> {
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  await query(config, `delete from sessions where token = $1`, [token]);
}

export async function registerUser(
  config: Config, email: string, password: string, name: string, country: string,
): Promise<SessionUser> {
  const existing = await query(config, 'select 1 from users where email = $1', [email]);
  if (existing.rows.length > 0) throw new Error('email_taken');
  const id = newId('user');
  await query(
    config,
    `insert into users (id, email, password_hash, name, country, role) values ($1, $2, $3, $4, $5, 'rider')`,
    [id, email, hashPassword(password), name, country],
  );
  return { id, email, name, country, role: 'rider', landing: '/orders' };
}

export async function signIn(config: Config, email: string, password: string): Promise<SessionUser | null> {
  const r = await query<{ id: string; email: string; name: string; country: string; role: 'rider' | 'fitter'; password_hash: string }>(
    config,
    'select id, email, name, country, role, password_hash from users where email = $1',
    [email],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, country: row.country, role: row.role, landing: row.role === 'fitter' ? '/desk' : '/orders' };
}

export function serialiseUser(u: SessionUser): Record<string, unknown> {
  return { id: u.id, email: u.email, name: u.name, country: u.country, role: u.role, landing: u.landing };
}
