import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const KEY_LENGTH = 32;

/** Passwords are stored only as salted slow hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await derive(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const key = (await derive(password, salt, expected.length)) as Buffer;
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Partner keys are stored only as hashes. */
export function hashPartnerKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
