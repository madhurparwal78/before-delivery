import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pool } from './db.js';

const COOKIE = 'skinout_session';

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function passphraseMatches(passphrase: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(passphrase, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const pairs: Record<string, string> = {};
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    pairs[part.slice(0, equals).trim()] = part.slice(equals + 1).trim();
  }
  return pairs;
}

/** A live session is a server-side row named by the cookie. */
export async function sessionFor(req: IncomingMessage): Promise<string | null> {
  const id = cookies(req)[COOKIE];
  if (id === undefined || id === '') return null;
  const result = await pool.query<{ id: string }>('SELECT id FROM sessions WHERE id = $1', [id]);
  return result.rows[0]?.id ?? null;
}

export async function createSession(): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (id) VALUES ($1)', [id]);
  return id;
}

export async function endSession(id: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
}

export function sessionCookie(id: string): string {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
