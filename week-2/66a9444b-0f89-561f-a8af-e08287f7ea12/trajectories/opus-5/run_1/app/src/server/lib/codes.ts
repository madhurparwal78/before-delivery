import { randomBytes, randomUUID, createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[(bytes[index] as number) % alphabet.length];
  }
  return out;
}

export const newOrderRef = (): string => `KF-${randomFrom(ALPHABET, 6)}`;
export const newPassCode = (): string => `KFP-${randomFrom(ALPHABET, 10)}`;
export const newVoucherCode = (): string => `KERF-${randomFrom(ALPHABET, 8)}`;
export const newId = (): string => randomUUID();

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || saltText === undefined || hashText === undefined) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const derived = scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length);
  return timingSafeEqual(expected, derived);
}

export function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A stable hash of a JSON body compared by value, not by key order. */
export function canonicalJsonHash(value: unknown): string {
  return sha256Hex(canonical(value));
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
