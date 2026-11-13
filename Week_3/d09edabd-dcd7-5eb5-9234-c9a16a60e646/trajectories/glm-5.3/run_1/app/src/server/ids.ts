import crypto from 'node:crypto';
import { withDb } from './db.js';

export const APP_VERSION = '1.0.0';

export function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function uid32(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function secret(key: string): Promise<string> {
  return withDb(async (c) => {
    const cur = await c.query('SELECT value FROM app_secrets WHERE key = $1', [key]);
    if (cur.rows.length) return cur.rows[0].value as string;
    const value = crypto.randomBytes(32).toString('hex');
    // Two instances may race; the first writer wins.
    await c.query(
      'INSERT INTO app_secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
    const again = await c.query('SELECT value FROM app_secrets WHERE key = $1', [key]);
    return again.rows[0].value as string;
  });
}
