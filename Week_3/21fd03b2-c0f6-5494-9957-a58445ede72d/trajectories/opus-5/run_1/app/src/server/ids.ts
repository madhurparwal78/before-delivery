import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomChars(count: number): string {
  const bytes = randomBytes(count);
  let out = '';
  for (let index = 0; index < count; index += 1) out += ALPHABET[bytes[index] % ALPHABET.length];
  return out;
}

/** Opaque ids: lowercase letters, digits and hyphens. */
export function newId(): string {
  return randomChars(20);
}

/** URL-safe tokens with at least 128 bits of randomness. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}
