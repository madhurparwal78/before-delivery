import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { query, queryOne } from './db.js';
import type { PersonRow } from './repo.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;
const COST = 16_384;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${COST}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = (await scrypt(password, Buffer.from(salt, 'base64'), KEY_LENGTH)) as Buffer;
  const want = Buffer.from(expected, 'base64');
  return derived.length === want.length && timingSafeEqual(derived, want);
}

export const SESSION_COOKIE = 'keelson_session';

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(personId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, person_id, created_at, expires_at)
     VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)`,
    [hashSessionToken(token), personId, String(config.sessionTtlSeconds)],
  );
  return token;
}

export async function personForSession(token: string): Promise<PersonRow | null> {
  return queryOne<PersonRow>(
    `SELECT who.id, who.email, who.name FROM sessions s
     JOIN people who ON who.id = s.person_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
}

export async function endSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}
