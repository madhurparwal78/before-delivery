import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 32);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const key = await scryptAsync(password, parts[1]!, 32);
  const expected = Buffer.from(parts[2]!, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
