import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { one, query } from './db';
import { type Ctx, unauthenticated } from './http';

const COOKIE = 'twinrow_session';

export interface User {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  reduceMotion: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  reduce_motion: boolean;
  password_hash: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export async function createSession(userId: string, res: ServerResponse): Promise<void> {
  const token = newToken();
  await query('insert into sessions (token, user_id) values ($1, $2)', [token, userId]);
  res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

export async function endSession(ctx: Ctx): Promise<void> {
  const token = ctx.cookies[COOKIE];
  if (token) await query('delete from sessions where token = $1', [token]);
  ctx.res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    verified: row.verified,
    reduceMotion: row.reduce_motion,
  };
}

export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const row = await one<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.token = $1`,
    [token],
  );
  return row ? toUser(row) : null;
}

export async function currentUser(ctx: Ctx): Promise<User | null> {
  return userForToken(ctx.cookies[COOKIE]);
}

export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await currentUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

export async function userByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await one<UserRow>('select * from users where lower(email) = lower($1)', [email]);
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  verified = false,
): Promise<User> {
  const row = await one<UserRow>(
    `insert into users (id, name, email, password_hash, verified)
     values ($1, $2, $3, $4, $5) returning *`,
    [randomUUID(), name, email, hashPassword(password), verified],
  );
  return toUser(row!);
}

export const sessionCookieName = COOKIE;
