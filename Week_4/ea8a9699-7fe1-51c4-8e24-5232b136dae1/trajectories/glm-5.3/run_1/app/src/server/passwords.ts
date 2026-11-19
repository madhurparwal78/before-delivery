import crypto from 'node:crypto';

const KEYLEN = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT_OPTIONS).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1]!;
  const hash = parts[2]!;
  const candidate = crypto.scryptSync(password, salt, KEYLEN, SCRYPT_OPTIONS).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(24).toString('hex')}`;
}

export function newId(): string {
  return crypto.randomUUID();
}
