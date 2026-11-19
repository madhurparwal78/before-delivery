import { randomBytes, createHash } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function shortId(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function tokenHex(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

export const guestName = (): string => `Guest ${shortId(4)}`;

export const runSeed = (): string => tokenHex(16);

export const sha256Hex = (data: Buffer | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
