/**
 * Accounts and sessions.
 *
 * Sessions live in PostgreSQL, so a cookie issued by one instance is accepted
 * by every instance on the database. A session lasts `SESSION_SECONDS` real
 * seconds from sign-in and does not extend with use.
 */

import { randomUUID } from 'node:crypto';

import type { DeliveryCountry, Role, User } from '../../shared/types.js';
import { SESSION_SECONDS, realNow } from '../domain/clock.js';
import { hashPassword, verifyPassword } from '../db/seed.js';
import { query } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';

export const SESSION_COOKIE = 'of_session';
export const MIN_PASSWORD_LENGTH = 10;

const DELIVERY_COUNTRIES: DeliveryCountry[] = ['NL', 'BE', 'DE', 'LU'];

interface UserRow {
  id: string;
  email: string;
  name: string;
  country: DeliveryCountry;
  role: Role;
  password_hash: string;
  password_salt: string;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    country: row.country,
    role: row.role,
    landing: row.role === 'fitter' ? '/desk' : '/orders',
  };
}

export interface RegisterInput {
  email: unknown;
  password: unknown;
  name: unknown;
  country: unknown;
}

export async function register(input: RegisterInput): Promise<{ user: User; sessionId: string }> {
  const errors: Record<string, string> = {};

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter an email address.';

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) errors.name = 'Required.';

  const country = input.country as DeliveryCountry;
  if (!DELIVERY_COUNTRIES.includes(country)) errors.country = 'Enter NL, BE, DE or LU.';

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) throw new ApiError(409, 'email_taken');

  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  const inserted = await query<UserRow>(
    `INSERT INTO users(id, email, password_hash, password_salt, name, country, role)
     VALUES ($1, $2, $3, $4, $5, $6, 'rider')
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [id, email, hash, salt, name, country],
  );
  const row = inserted.rows[0];
  if (!row) throw new ApiError(409, 'email_taken');

  return { user: toUser(row), sessionId: await openSession(row.id) };
}

export async function signIn(email: unknown, password: unknown): Promise<{ user: User; sessionId: string }> {
  const badCredentials = new ApiError(401, 'bad_credentials');
  if (typeof email !== 'string' || typeof password !== 'string') throw badCredentials;

  const found = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  const row = found.rows[0];
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) throw badCredentials;

  return { user: toUser(row), sessionId: await openSession(row.id) };
}

async function openSession(userId: string): Promise<string> {
  const id = randomUUID();
  const now = realNow();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await query('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    id,
    userId,
    now.toISOString(),
    expires.toISOString(),
  ]);
  return id;
}

export async function signOut(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** The signed-in user, or null for no session or one past its lifetime. */
export async function userForSession(sessionId: string | null): Promise<User | null> {
  if (!sessionId) return null;
  const found = await query<UserRow & { expires_at: Date }>(
    `SELECT u.*, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sessionId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= realNow().getTime()) return null;
  return toUser(row);
}
