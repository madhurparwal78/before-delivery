import crypto from 'node:crypto';

/** scrypt password hashing: salt and parameters stored with the digest. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, parts[1], 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(parts[2]));
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
