import crypto from 'node:crypto';

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function randomToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomJoinCode(): string {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function newSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
