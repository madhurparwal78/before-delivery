import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unguessable capability link token: 128 bits of randomness in URL-safe characters. */
export function generateToken(): string {
  const bytes = randomBytes(24);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i]! % 64];
  }
  return out;
}
