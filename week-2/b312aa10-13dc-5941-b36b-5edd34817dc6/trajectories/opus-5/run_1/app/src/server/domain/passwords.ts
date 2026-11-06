import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const keyLength = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password.normalize('NFC'), salt, keyLength).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = scryptSync(password.normalize('NFC'), parts[1]!, keyLength);
  const expected = Buffer.from(parts[2]!, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
