import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** An opaque id made of letters, digits, "-" and "_", so cell ids fit the open format. */
export function newId(): string {
  return randomBytes(12).toString('base64url');
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, derived] = stored.split(':');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(derived, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
