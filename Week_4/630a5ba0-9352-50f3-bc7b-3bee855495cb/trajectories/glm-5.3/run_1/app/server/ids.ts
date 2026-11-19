import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

export function newFeedToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1] ?? '';
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sha256Hex(text: string): string {
  return createHmac('sha256', 'tidemark-digest').update(text).digest('hex');
}

export function hmacSign(key: string, text: string): string {
  return createHmac('sha256', key).update(text).digest('hex');
}
