import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (p: string, s: string, k: number) => Promise<Buffer>;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = await scryptAsync(password, parts[1]!, KEYLEN);
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}
