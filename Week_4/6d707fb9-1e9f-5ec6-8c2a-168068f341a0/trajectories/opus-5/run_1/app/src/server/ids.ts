import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALPHABET = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export function newId(): string {
  const bytes = randomBytes(18);
  let text = '';
  for (const byte of bytes) text += ALPHABET[byte % ALPHABET.length];
  return text;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A monotonic sort index, so rows keep the order they were made in. */
let lastIndex = 0;
export function nextSortIndex(): number {
  const now = Date.now() * 1000;
  lastIndex = now > lastIndex ? now : lastIndex + 1;
  return lastIndex;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${salt.toString('base64url')}.${derived.toString('base64url')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [saltText, derivedText] = stored.split('.');
  if (!saltText || !derivedText) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(derivedText, 'base64url');
  const found = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, found);
}
