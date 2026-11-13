import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
