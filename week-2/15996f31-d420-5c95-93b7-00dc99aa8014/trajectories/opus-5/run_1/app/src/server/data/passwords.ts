import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, KEY_LENGTH).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
