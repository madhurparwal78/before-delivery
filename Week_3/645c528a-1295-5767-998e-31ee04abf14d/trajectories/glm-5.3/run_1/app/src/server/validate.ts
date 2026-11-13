import type { PoolClient } from './db.js';
import type { Db } from './db.js';
import { errors } from './errors.js';

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  birthYear: number;
}

export type AccountFields = { email?: string; password?: string; displayName?: string; birthYear?: number };

export async function validateSignup(input: AccountFields, currentYear: number): Promise<{ ok: true; value: SignupInput } | { ok: false; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const birthYear = typeof input.birthYear === 'number' ? input.birthYear : Number.NaN;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
  if (password.length < 8 || password.length > 72) fields.password = 'Use at least 8 characters.';
  if (displayName.length < 2 || displayName.length > 20) fields.displayName = 'Use 2 to 20 characters.';
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) fields.birthYear = 'Enter a four-digit year.';
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { email, password, displayName, birthYear } };
}

export async function withPlayerLock(client: PoolClient, playerId: string): Promise<void> {
  await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
}

export async function storeDown(db: Db, err: unknown): Promise<never> {
  const msg = (err as Error).message ?? '';
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') throw errors.storeUnavailable();
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || msg.includes('connection')) {
    throw errors.storeUnavailable();
  }
  throw err;
}
