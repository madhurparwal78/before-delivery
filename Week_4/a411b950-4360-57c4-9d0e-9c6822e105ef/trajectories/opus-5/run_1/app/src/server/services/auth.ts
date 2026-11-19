import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from '../db/pool.ts';

const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2] as string, 'hex');
  const derived = scryptSync(password, parts[1] as string, KEY_LENGTH);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function createSession(operatorEmail: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(`INSERT INTO console_sessions (token, operator_email) VALUES ($1, $2)`, [token, operatorEmail]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await query(`DELETE FROM console_sessions WHERE token = $1`, [token]);
}

export function sessionTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('earshot_session='));
  return pair === undefined ? null : pair.slice('earshot_session='.length) || null;
}
