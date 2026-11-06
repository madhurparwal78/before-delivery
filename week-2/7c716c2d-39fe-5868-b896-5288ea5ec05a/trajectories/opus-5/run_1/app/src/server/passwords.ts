import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || key === undefined) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
