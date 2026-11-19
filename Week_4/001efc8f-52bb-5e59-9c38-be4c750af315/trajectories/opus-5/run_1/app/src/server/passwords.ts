import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const [scheme, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'scrypt' || saltPart === undefined || hashPart === undefined) return false;
  const salt = Buffer.from(saltPart, 'base64');
  const expected = Buffer.from(hashPart, 'base64');
  const derived = await scryptAsync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
