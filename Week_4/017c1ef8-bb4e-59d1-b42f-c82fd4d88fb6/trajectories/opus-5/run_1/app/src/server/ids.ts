import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix: string): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function newConfirmationCode(): string {
  const value = randomBytes(4).readUInt32BE(0) % 1000000;
  return value.toString().padStart(6, '0');
}
