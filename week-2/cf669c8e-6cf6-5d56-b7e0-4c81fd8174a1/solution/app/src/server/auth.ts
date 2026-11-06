/** Accounts: email-and-password sign-in for riders and the seeded fitter; sessions live in PostgreSQL. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { oneOf } from '../shared/choice.js';
import { DELIVERY_COUNTRIES, type Country, type User } from '../shared/types.js';
import { config } from './config.js';
import { hashPassword, one, query, scrypted, sql } from './db.js';
import { fail, invalid } from './errors.js';

export const COOKIE = 'of_session';

interface UserRow { id: string; email: string; name: string; country: Country; role: 'rider' | 'fitter' }

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, country: row.country, role: row.role, landing: row.role === 'fitter' ? '/desk' : '/orders' };
}

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers['cookie'];
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export async function currentUser(req: IncomingMessage): Promise<User | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const row = await one<UserRow>(
    sql,
    'SELECT u.id, u.email, u.name, u.country, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()',
    [token],
  );
  return row ? toUser(row) : null;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const actual = await scrypted(password, Buffer.from(salt, 'hex'));
  const expected = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(sql, "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))", [token, userId, config.sessionSeconds]);
  await query(sql, 'DELETE FROM sessions WHERE expires_at < now() - interval \'1 hour\'');
  return token;
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function register(input: Record<string, unknown>): Promise<{ user: User; token: string }> {
  const errors: Record<string, string> = {};
  const email = typeof input['email'] === 'string' ? input['email'].trim() : '';
  const password = typeof input['password'] === 'string' ? input['password'] : '';
  const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
  const country = input['country'];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) errors['email'] = 'Enter an email address.';
  if (password.length < 10) errors['password'] = 'Use at least 10 characters.';
  if (!name || name.length > 100) errors['name'] = 'Enter your name.';
  if (!oneOf(country, DELIVERY_COUNTRIES)) errors['country'] = 'Enter NL, BE, DE or LU.';
  if (Object.keys(errors).length) throw invalid(errors);
  const hash = await hashPassword(password);
  const row = await one<UserRow>(
    sql,
    'INSERT INTO users (email, name, country, role, password_hash) VALUES ($1,$2,$3,\'rider\',$4) ON CONFLICT DO NOTHING RETURNING id, email, name, country, role',
    [email, name, country, hash],
  );
  if (!row) throw fail(409, 'email_taken');
  return { user: toUser(row), token: await startSession(row.id) };
}

export async function signIn(input: Record<string, unknown>): Promise<{ user: User; token: string }> {
  const email = typeof input['email'] === 'string' ? input['email'].trim() : '';
  const password = typeof input['password'] === 'string' ? input['password'] : '';
  const row = await one<UserRow & { password_hash: string }>(
    sql, 'SELECT id, email, name, country, role, password_hash FROM users WHERE lower(email) = lower($1)', [email],
  );
  if (!row || !(await verifyPassword(password, row.password_hash))) throw fail(401, 'bad_credentials');
  return { user: toUser(row), token: await startSession(row.id) };
}

export async function signOut(req: IncomingMessage): Promise<void> {
  const token = cookieToken(req);
  if (token) await query(sql, 'DELETE FROM sessions WHERE token = $1', [token]);
}
