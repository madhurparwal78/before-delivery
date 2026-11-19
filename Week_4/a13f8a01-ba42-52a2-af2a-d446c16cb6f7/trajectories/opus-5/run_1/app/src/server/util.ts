import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Opaque ids are ten lowercase letters and digits. */
export const newId = (): string => {
  let id = '';
  for (let index = 0; index < 10; index += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
};

export const newToken = (): string => randomBytes(24).toString('hex');

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
};

export const verifyPassword = (password: string, stored: string | null): boolean => {
  if (stored === null) return false;
  const [scheme, salt, derived] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !derived) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(derived, 'hex');
  return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
};

export const isoTime = (value: Date): string => value.toISOString();
