import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 32);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const key = await scrypt(password, parts[1], 32);
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function uuid(): string {
  return randomUUID();
}
