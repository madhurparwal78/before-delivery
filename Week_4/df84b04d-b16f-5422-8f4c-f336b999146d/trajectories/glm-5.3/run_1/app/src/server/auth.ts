import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = createHash('sha256').update('twigline-salt:' + password).digest('hex').slice(0, 16);
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const salt = parts[1] ?? '';
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashCode(code: string): string {
  return createHash('sha256').update('twigline-code:' + code).digest('hex');
}
