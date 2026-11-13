import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Client } from '../db.js';
import { newToken } from '../http/core.js';
import type { SessionUser } from '../http/core.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.byteLength === expected.byteLength && timingSafeEqual(derived, expected);
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export async function createSession(client: Client, userId: string): Promise<string> {
  const token = newToken();
  await client.query('insert into sessions (id, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export async function userForSession(client: Client, token: string): Promise<SessionUser | null> {
  const found = await client.query<{ id: string; username: string }>(
    'select u.id, u.username from sessions s join users u on u.id = s.user_id where s.id = $1',
    [token],
  );
  return found.rows[0] ?? null;
}

export async function dropSession(client: Client, token: string): Promise<void> {
  await client.query('delete from sessions where id = $1', [token]);
}
