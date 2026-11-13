import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db';
import { foldEmail } from '../shared/order';
import { SessionUser } from './http';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(email: string): boolean {
  return EMAIL.test(email);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export type UserRow = {
  id: string;
  email: string;
  email_folded: string;
  password_hash: string;
  display_name: string;
  verified: boolean;
};

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>('select * from users where email_folded = $1', [foldEmail(email)]);
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>('select * from users where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function createUser(
  email: string,
  password: string,
  displayName: string,
  verified: boolean,
  createdAt: Date,
): Promise<UserRow> {
  const id = randomUUID();
  const result = await query<UserRow>(
    `insert into users (id, email, email_folded, password_hash, display_name, verified, created_at)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [id, email, foldEmail(email), hashPassword(password), displayName, verified, createdAt],
  );
  return result.rows[0];
}

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  await query('insert into sessions (id, user_id, created_at) values ($1, $2, now())', [id, userId]);
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await query('delete from sessions where id = $1', [id]);
}

export async function userOfSession(sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const result = await query<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified };
}

export async function createVerificationToken(userId: string, nextPath: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query(
    'insert into verification_tokens (token, user_id, next_path, created_at) values ($1, $2, $3, now())',
    [token, userId, nextPath],
  );
  return token;
}

/** `next` is used only when it starts with one `/` that is not followed by `/` or `\`. */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== 'string' || next.length === 0) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.length > 1 && (next[1] === '/' || next[1] === '\\')) return '/';
  return next;
}
