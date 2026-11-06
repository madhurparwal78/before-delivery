import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/**
 * Passwords are stored only as a salted slow hash. The stand-in hash lets a
 * sign-in for an unknown email run the same slow check, so timing cannot
 * reveal which emails are registered.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = await scryptAsync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A fixed-format stand-in hash for unknown emails at sign-in. */
export async function standInHash(): Promise<string> {
  return hashPassword(randomBytes(24).toString('hex'));
}

/** A random bearer token. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
