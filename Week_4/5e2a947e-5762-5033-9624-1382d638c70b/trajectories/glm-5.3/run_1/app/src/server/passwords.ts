import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** Salted slow hash for passwords. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(pw, salt, 32)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const derived = (await scryptAsync(pw, salt, 32)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
