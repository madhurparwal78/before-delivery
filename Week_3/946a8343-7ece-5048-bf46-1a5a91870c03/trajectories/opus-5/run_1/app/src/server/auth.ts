import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Sql, db } from './db';
import { ApiError, errors } from './errors';

export type User = { id: number; username: string; time_zone: string };

export const usernamePattern = /^[a-z0-9_]{3,24}$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  if (salt === undefined || derived === undefined) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function validateCredentials(username: unknown, password: unknown): ApiError | null {
  if (typeof username !== 'string' || !usernamePattern.test(username)) {
    return errors.validation('username', 'Username must be 3 to 24 characters: a-z, 0-9 and _.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    return errors.validation('password', 'Password must be at least 8 characters.');
  }
  return null;
}

export async function createSession(sql: Sql, userId: number): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await sql.query('insert into sessions (token, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export async function userForToken(token: string): Promise<User | null> {
  return db.one<User>(
    `select users.id, users.username, users.time_zone
     from sessions join users on users.id = sessions.user_id
     where sessions.token = $1`,
    [token],
  );
}

export async function userByName(sql: Sql, username: string): Promise<User | null> {
  return sql.one<User>('select id, username, time_zone from users where username = $1', [username]);
}

export function sessionCookie(token: string): string {
  return `spur_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedCookie(): string {
  return 'spur_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
