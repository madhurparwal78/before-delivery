import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * A stand-in hash so that an unknown email runs the same slow check as a
 * wrong password, keeping the two paths indistinguishable.
 */
export const DECOY_PASSWORD_HASH =
  'scrypt$16384$8$1$a2VlbC1vdXRwb3N0LWRlY295$P0hCVrQH2dVZsBq3TTRunTh4lfAAW6BCu7U34RWvRlQ=';

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  const [scheme, n, r, p, salt, key] = parts;
  if (scheme !== 'scrypt' || n === undefined || r === undefined || p === undefined || salt === undefined || key === undefined) {
    return false;
  }
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
