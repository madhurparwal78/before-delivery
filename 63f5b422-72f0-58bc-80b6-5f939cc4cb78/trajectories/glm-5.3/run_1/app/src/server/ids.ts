import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBase(len: number): string {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBase(12)}`;
}

export function inviteToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function sessionToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// scrypt password hashing
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `s1:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const hash = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(hash, expected);
}
