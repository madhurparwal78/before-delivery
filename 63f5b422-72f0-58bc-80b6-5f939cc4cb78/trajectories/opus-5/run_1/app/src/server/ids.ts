import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type IdPrefix =
  | 'w'
  | 'pg'
  | 'n'
  | 'cp'
  | 'e'
  | 'img'
  | 'm'
  | 'v'
  | 'u'
  | 'pub'
  | 'inv'
  | 's';

export function newId(prefix: IdPrefix): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function inviteToken(): string {
  return randomBytes(32).toString('base64url');
}
