import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

/** 43 URL-safe characters from 32 random bytes. */
export function shareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function inviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function bodyHash(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (failure, key) => (failure ? reject(failure) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await derive(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
