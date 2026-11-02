import crypto from 'node:crypto';
import type { PocketBaseUser, UserRole } from '../services/pocketbase.js';
import { query, queryOne } from './pool.js';

export const SESSION_COOKIE = 'ceibo_session';
export const CART_COOKIE = 'ceibo_cart';

/**
 * Sessions carry the signed-in identity, so staff already signed in keep working
 * while PocketBase is unreachable.
 */
export async function startSession(user: PocketBaseUser): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    'insert into sessions (token, user_id, email, name, role) values ($1, $2, $3, $4, $5)',
    [token, user.id, user.email, user.name, user.role],
  );
  return token;
}

export async function readSession(token: string): Promise<PocketBaseUser | null> {
  const row = await queryOne<{ user_id: string; email: string; name: string; role: string }>(
    'select user_id, email, name, role from sessions where token = $1',
    [token],
  );
  if (row === null) return null;
  return { id: row.user_id, email: row.email, name: row.name, role: row.role as UserRole };
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}
