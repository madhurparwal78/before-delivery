import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;
const SCRYPT_COST = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: SCRYPT_COST,
    r: 8,
    p: 1,
  });
  return timingSafeEqual(expected, actual);
}
