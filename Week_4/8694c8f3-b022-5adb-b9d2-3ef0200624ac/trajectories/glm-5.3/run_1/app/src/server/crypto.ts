import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export function hashPassword (password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptHex(password, salt)}`;
}

async function scryptHex (password: string, salt: Buffer): Promise<string> {
  const derived = await scrypt(password, salt, 64);
  return derived.toString('hex');
}

export async function verifyPassword (password: string, stored: string): Promise<boolean> {
  const [saltHex, hash] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const derivedHex = await scryptHex(password, salt);
  const expected = Buffer.from(hash, 'hex');
  const derived = Buffer.from(derivedHex, 'hex');
  if (expected.byteLength !== derived.byteLength) return false;
  return timingSafeEqual(expected, derived);
}

export const newId = (): string => {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const newToken = (): string => randomBytes(24).toString('base64url');

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export const newSessionId = (): string => randomBytes(32).toString('base64url');
