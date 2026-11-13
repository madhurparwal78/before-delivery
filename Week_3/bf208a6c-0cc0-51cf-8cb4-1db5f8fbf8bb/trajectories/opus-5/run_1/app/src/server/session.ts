import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookieSecret } from './env';

const sign = (payload: string): string => {
  const mac = createHmac('sha256', cookieSecret).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac}`;
};

const unsign = (value: string): string | null => {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = Buffer.from(value.slice(0, dot), 'base64url').toString('utf8');
  const expected = createHmac('sha256', cookieSecret).update(payload).digest('base64url');
  const given = value.slice(dot + 1);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return payload;
};

export const SESSION_COOKIE = 'pinsheet_session';
export const UNLOCK_COOKIE = 'pinsheet_pass';

export const makeSessionValue = (userId: string): string => sign(userId);

export const readSessionValue = (value: string | undefined): string | null => (value ? unsign(value) : null);

export type Unlocks = Record<string, number>;

export const makeUnlockValue = (unlocks: Unlocks): string => sign(JSON.stringify(unlocks));

export const readUnlockValue = (value: string | undefined): Unlocks => {
  if (!value) return {};
  const payload = unsign(value);
  if (payload === null) return {};
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== 'object' || parsed === null) return {};
  const unlocks: Unlocks = {};
  for (const [key, generation] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof generation === 'number') unlocks[key] = generation;
  }
  return unlocks;
};

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = scryptSync(password, Buffer.from(salt, 'base64url'), 32);
  const expected = Buffer.from(digest, 'base64url');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};
