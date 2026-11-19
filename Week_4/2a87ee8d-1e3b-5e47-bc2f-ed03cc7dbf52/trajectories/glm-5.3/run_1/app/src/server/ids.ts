/** Ids and tokens: opaque strings from a secure random source. */
import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

/** A join-link token: at least 32 chars of letters, digits, - and _, 128+ bits of randomness (DP-06). */
export function newJoinToken(): string {
  const bytes = randomBytes(24); // 192 bits
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 64];
  return out;
}

/** A recap token: letters, digits, - and _ only. */
export function newRecapToken(): string {
  const bytes = randomBytes(18);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 64];
  return out;
}

/** An operation id from the client, or a fresh one for internal use. */
export function newOpId(): string {
  return randomBytes(16).toString('base64url');
}
