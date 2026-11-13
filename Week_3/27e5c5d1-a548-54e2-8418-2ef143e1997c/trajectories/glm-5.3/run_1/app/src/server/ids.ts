import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, len: number) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

/** Salted, slow password hash: the only place passwords are stored or checked. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Random session tokens: at least 128 bits of entropy. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

let idCounter = 0;

/** Opaque ids: 22+ characters matching the published id shape. */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand = randomBytes(9).toString('base64url').slice(0, 10).replace(/[-_]/g, 'a');
  return `${prefix}-${rand}${idCounter.toString(36).padStart(4, '0')}${Date.now().toString(36).slice(-5)}`;
}
