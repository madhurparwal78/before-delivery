import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const hash = scryptSync(password, parts[1], 32);
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== hash.length) return false;
  return timingSafeEqual(hash, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
