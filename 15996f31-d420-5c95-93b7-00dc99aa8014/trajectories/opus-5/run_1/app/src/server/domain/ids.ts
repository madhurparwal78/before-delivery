import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuv';

/**
 * Opaque ids with a time-ordered prefix so that lexicographic order matches
 * creation order; the allocation leftover cent and share ordering rely on it.
 */
export function newId(prefix: string): string {
  const stamp = Date.now().toString(32).padStart(10, '0');
  const bytes = randomBytes(8);
  let tail = '';
  for (const byte of bytes) tail += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${stamp}${tail}`;
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}
