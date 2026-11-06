import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

const SCRYPT_KEY_BYTES = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEY_BYTES);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] as string, 'base64');
  const expected = Buffer.from(parts[2] as string, 'base64');
  if (expected.length !== SCRYPT_KEY_BYTES) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEY_BYTES);
  return timingSafeEqual(actual, expected);
}

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** A claim reference: "HL-" followed by 6 capital letters or digits. */
export function newClaimReference(): string {
  const bytes = randomBytes(6);
  let body = '';
  for (const byte of bytes) {
    body += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return `HL-${body}`;
}
