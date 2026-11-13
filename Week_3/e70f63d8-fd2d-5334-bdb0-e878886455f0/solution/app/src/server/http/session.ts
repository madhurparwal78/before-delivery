import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import type { User } from '../../shared/wire.js';
import { query } from '../db/pool.js';

export const SESSION_COOKIE = 'oc_session';
const KEY_BYTES = 64;
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(password, salt, KEY_BYTES)).toString('hex')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  return timingSafeEqual(await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length), expected);
};

/** A hash to verify against when the email is unknown, so unknown and wrong cost the same work. */
export const DUMMY_HASH = await hashPassword(randomBytes(8).toString('hex'));

export const cookieOf = (req: IncomingMessage, name: string): string | null => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
};

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`;
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export const createSession = async (userId: string): Promise<string> => {
  const token = newToken();
  await query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [hashToken(token), userId]);
  return token;
};

export const userOfRequest = async (req: IncomingMessage): Promise<User | null> => {
  const token = cookieOf(req, SESSION_COOKIE);
  if (token === null) return null;
  const rows = await query<{ id: string; email: string; display_name: string }>(
    `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, display_name: row.display_name } : null;
};
