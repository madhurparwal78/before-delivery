import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { serverNow } from '../server/clock.js';
import type { Db } from '../server/db.js';

export const RESERVED_USERNAMES = new Set(['merge-queue']);
const USERNAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function createUser(
  tx: Db,
  input: { email: string; username: string; name: string; password: string; confirmed: boolean },
): Promise<{ id: number; confirmToken: string }> {
  const confirmToken = randomBytes(18).toString('hex');
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO rs_users (username, email, name, password_hash, confirmed, confirm_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.username,
      input.email,
      input.name,
      hashPassword(input.password),
      input.confirmed,
      input.confirmed ? null : confirmToken,
      serverNow(),
    ],
  );
  return { id: Number(rows[0].id), confirmToken };
}
