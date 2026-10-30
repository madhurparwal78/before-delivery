import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, keyPart] = stored.split('$');
  if (scheme !== 'scrypt' || saltPart === undefined || keyPart === undefined) return false;
  const expected = Buffer.from(keyPart, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltPart, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
