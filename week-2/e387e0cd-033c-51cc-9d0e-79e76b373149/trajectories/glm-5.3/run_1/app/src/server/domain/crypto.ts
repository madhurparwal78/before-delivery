import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Passwords are stored only as salted slow hashes; partner keys only as hashes.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function newSessionId(): string {
  return randomBytes(24).toString('hex');
}

export function hmacSha256Hex(key: string, data: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function hashPartnerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
