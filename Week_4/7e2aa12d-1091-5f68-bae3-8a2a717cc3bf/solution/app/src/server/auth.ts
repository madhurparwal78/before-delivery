import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type pg from 'pg';
import { pool } from './db.js';

const COOKIE = 'mullion_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'base64url')), Buffer.from(hash, 'base64url'));
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A random token of 128 bits, used for view and co-edit links. */
export const newToken = (): string => randomBytes(16).toString('base64url');

export async function startSession(userId: number, database: Pick<pg.Pool, 'query'> = pool): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await database.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [digest(token), userId]);
  return token;
}

export const endSession = (token: string): Promise<unknown> => pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);

export const sessionCookie = (token: string): string => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
export const clearedCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function cookieToken(request: IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE && value.length) return value.join('=');
  }
  return null;
}

export interface User {
  id: number;
  username: string;
}

export async function userOf(request: IncomingMessage): Promise<User | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const { rows } = await pool.query<User>('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [digest(token)]);
  return rows[0] ?? null;
}
