import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

/**
 * Server-side sessions. A session is a record in Postgres named by an
 * HttpOnly, SameSite=Lax cookie. Signing out ends it for every tab that uses
 * the cookie, and an ended session never becomes valid again.
 */

export const SESSION_COOKIE = 'skinout_session';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(db: Db): Promise<string> {
  const token = newSessionToken();
  await db`INSERT INTO sessions (token) VALUES (${token})`;
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db`DELETE FROM sessions WHERE token = ${token}`;
}

export async function sessionLive(db: Db, token: string | undefined): Promise<boolean> {
  if (token === undefined || token === '') return false;
  const rows = await db`SELECT token FROM sessions WHERE token = ${token}`;
  return rows.length > 0;
}

/** Passphrase hashing: scrypt with a per-hiker salt, compared in constant time. */
export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(passphrase, salt, 32);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export function passphraseMatches(passphrase: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64');
  const expected = Buffer.from(parts[2]!, 'base64');
  const derived = scryptSync(passphrase, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

/** Share tokens carry at least 128 bits of randomness, URL-safe. */
export function newShareToken(): string {
  return randomBytes(24).toString('base64url');
}

export function newId(): string {
  return createHash('sha256').update(randomBytes(16)).digest('base64url').slice(0, 16);
}
