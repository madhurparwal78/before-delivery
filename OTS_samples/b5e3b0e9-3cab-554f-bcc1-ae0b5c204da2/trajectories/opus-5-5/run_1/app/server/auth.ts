import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';
import { type Ctx, notFound, unauthenticated } from './http.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export const COOKIE = 'runup_session';

export interface User {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  reduce_motion: boolean;
  password_hash: string;
}

export interface School {
  id: string;
  name: string;
  instructor_id: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex ?? '', 'hex'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function startSession(userId: string): Promise<string> {
  const token = newToken();
  await query('INSERT INTO auth_sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function userFromCookies(cookies: Record<string, string>): Promise<User | null> {
  const token = cookies[COOKIE];
  if (!token) return null;
  const user = await one<User>(
    'SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
    [token],
  );
  return user ?? null;
}

export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await userFromCookies(ctx.cookies);
  if (!user) throw unauthenticated();
  return user;
}

export async function schoolOf(userId: string): Promise<School | null> {
  return (await one<School>('SELECT * FROM schools WHERE instructor_id = $1', [userId])) ?? null;
}

export async function requireInstructor(ctx: Ctx): Promise<{ user: User; school: School }> {
  const user = await requireUser(ctx);
  const school = await schoolOf(user.id);
  if (!school) throw notFound();
  return { user, school };
}
