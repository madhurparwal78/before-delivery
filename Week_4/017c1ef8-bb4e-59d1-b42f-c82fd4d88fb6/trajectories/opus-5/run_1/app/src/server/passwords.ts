import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, digestHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(digestHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
