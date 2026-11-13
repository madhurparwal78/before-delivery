import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../domain/routes.ts';
import { ApiError } from '../domain/errors.ts';
import { type Queryable, query } from './db.ts';

export interface SignedInUser {
  id: number;
  name: string | null;
  email: string;
  role: Role;
  operatorCode: string | null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (stored === null) return false;
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const derived = scryptSync(password, Buffer.from(salt, 'hex'), 32);
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export const SESSION_COOKIE = 'ditchbook_session';

export async function createSession(client: Queryable, userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await client.query('insert into sessions (token, user_id) values ($1,$2)', [token, userId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

interface SessionRow {
  id: number;
  name: string | null;
  email: string;
  role: Role;
  operator_code: string | null;
}

/** A session is valid only while the server still holds it. */
export async function userForToken(token: string | null): Promise<SignedInUser | null> {
  if (token === null) return null;
  const found = await query<SessionRow>(
    `select u.id, u.name, u.email, u.role, u.operator_code
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and u.erased = false`,
    [token],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, operatorCode: row.operator_code };
}

export function requireRole(user: SignedInUser | null, roles: readonly Role[]): SignedInUser {
  if (user === null) throw new ApiError('not_signed_in');
  if (!roles.includes(user.role)) throw new ApiError('forbidden');
  return user;
}
