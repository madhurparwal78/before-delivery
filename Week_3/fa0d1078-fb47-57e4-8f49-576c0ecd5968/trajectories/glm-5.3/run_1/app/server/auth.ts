import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: string, k: number) => Promise<Buffer>;

// Passwords are stored as scrypt hashes with per-player salts. Credentials
// are never hard-coded, logged or sent to the browser.

export interface PasswordHash {
  hash: string;
  salt: string;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 32);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await scrypt(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function sessionCookie(token: string): string {
  return `seam_session=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return `seam_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
