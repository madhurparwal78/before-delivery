import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST_N = 32_768; // 2^15
const COST_R = 8;
const COST_P = 1;
const MAXMEM = 128 * COST_N * COST_R * 2;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N: COST_N,
    r: COST_R,
    p: COST_P,
    maxmem: MAXMEM,
  });
  return `scrypt$${COST_N}$${COST_R}$${COST_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number.parseInt(parts[1] as string, 10);
  const r = Number.parseInt(parts[2] as string, 10);
  const p = Number.parseInt(parts[3] as string, 10);
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  const key = await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 128 * n * r * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 256 bits of cryptographic randomness, hex encoded. */
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export function newId(): string {
  return randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
