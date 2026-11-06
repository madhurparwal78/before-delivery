import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

export const PASSWORD_MIN_CHARS = 12;
export const PASSWORD_MAX_CHARS = 200;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const derived = scryptSync(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
