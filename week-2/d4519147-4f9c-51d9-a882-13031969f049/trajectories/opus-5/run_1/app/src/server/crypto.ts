import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** Passwords are stored only as memory-hard scrypt hashes, each with its own salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }));
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A capability token: at least 128 random bits, base64url encoded. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function randomNonce(): string {
  return randomBytes(16).toString('base64');
}

export function newId(): string {
  return randomUUID();
}

export function sessionIdValue(): string {
  return randomBytes(32).toString('base64url');
}
