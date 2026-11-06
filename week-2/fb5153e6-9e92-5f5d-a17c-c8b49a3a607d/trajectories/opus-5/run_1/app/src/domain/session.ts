import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

import type { Role } from '../shared/roles.js';

export type { Role };
export { landingRoute, mayOpenPage, requiresSignIn, destinationAfterSignIn } from '../shared/roles.js';

export interface Session {
  readonly id: string;
  readonly userId: number;
  readonly email: string;
  readonly role: Role;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'base64url');
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
