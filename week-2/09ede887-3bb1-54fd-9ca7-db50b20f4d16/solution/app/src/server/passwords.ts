import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

// Passwords are kept only as salted scrypt hashes; tokens only as SHA-256 digests.

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, COST, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt = '', expected = ''] = stored.split('$');
  const key = await derive(password, Buffer.from(salt, 'base64'));
  const wanted = Buffer.from(expected, 'base64');
  return wanted.length === key.length && timingSafeEqual(wanted, key);
}

// The stand-in an unknown email is checked against, so both refusals cost the same slow hash.
export const STAND_IN_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(KEY_LENGTH).toString('base64')}`;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
