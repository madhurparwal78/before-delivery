// Salted slow hashes for passwords and the session cookie helpers.
import crypto from 'node:crypto';

const ITERATIONS = 60000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'base64');
  const expected = Buffer.from(parts[3]!, 'base64');
  const derived = crypto.pbkdf2Sync(password, salt, iterations, expected.length, DIGEST);
  return crypto.timingSafeEqual(derived, expected);
}

export interface Cookie { name: string; value: string }

export function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

export function sessionCookie(value: string, clear = false): string {
  const base = `mullion_session=${clear ? '' : value}; Path=/; HttpOnly; SameSite=Lax`;
  return clear ? `${base}; Max-Age=0` : base;
}

export const SESSION_COOKIE = 'mullion_session';
