import { createHash, randomUUID } from 'crypto';

const ITER = 120000;

function pbkdf2Password(password: string): string {
  const salt = process.env.EW_HASH_SALT || 'everyweek-static-salt';
  const crypto = require('crypto') as { pbkdf2Sync: typeof import('crypto').pbkdf2Sync };
  const buf = crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256');
  return `pbkdf2$${ITER}$${buf.toString('hex')}`;
}

export function hashPassword(pw: string): string { return pbkdf2Password(pw); }

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const salt = process.env.EW_HASH_SALT || 'everyweek-static-salt';
    const parts = stored.split('$');
    const iter = Number(parts[1]);
    const hex = parts[2];
    const crypto = require('crypto') as { pbkdf2Sync: typeof import('crypto').pbkdf2Sync };
    const buf = crypto.pbkdf2Sync(pw, salt, iter, 32, 'sha256');
    return timingSafe(buf.toString('hex'), hex);
  } catch {
    return false;
  }
}

export function timingSafe(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

export function token(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

export function sixDigitCode(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

export function refCode(): string {
  return randomUUID().slice(0, 8).toUpperCase();
}
