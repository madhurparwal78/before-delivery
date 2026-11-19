import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** An opaque id made of letters and digits. */
export function newId(prefix: string): string {
  return `${prefix}_${randomToken(22)}`;
}

export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += BASE62[(bytes[index] as number) % BASE62.length];
  }
  return out;
}

/** A join or recap token: letters, digits, - and _ only, with well over 128 bits of randomness. */
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltText, expectedText] = stored.split('$');
  if (scheme !== 'scrypt' || saltText === undefined || expectedText === undefined) return false;
  const expected = Buffer.from(expectedText, 'base64');
  const derived = scryptSync(password, Buffer.from(saltText, 'base64'), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
