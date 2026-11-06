import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, saltB64, keyB64] = stored.split(':');
  if (scheme !== 'scrypt') return false;
  const salt = Buffer.from(saltB64, 'base64');
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(password, salt, key.length);
  return key.length === test.length && timingSafeEqual(key, test);
};

export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const newToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const tokenForPath = (token: string): boolean => /^[A-Za-z0-9_-]+$/.test(token);

export const requestFingerprint = (path: string, body: unknown): string =>
  createHmac('sha256', 'idem').update(`${path}:${JSON.stringify(body ?? null)}`).digest('hex');

export const sha256Hex = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
