import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (p: string, s: string, k: number) => Promise<Buffer>;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 32);
  return `${salt}:${derived.toString('hex')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const derived = await scryptAsync(password, salt, 32);
  const expected = Buffer.from(hex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};
