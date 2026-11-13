import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query, one } from './db.js';
import type { Locale } from '../shared/i18n/index.js';
import type { Account, StorageNotice } from '../shared/types.js';
import {
  DEFAULT_ACCESSORIES,
  DEFAULT_MATERIAL,
  DEFAULT_PARTS,
  DEFAULT_PROPORTIONS,
} from './domain/hero.js';

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  email_verified: boolean;
  verification_email: 'sent' | 'not_sent';
  storage_notice: StorageNotice;
  equipped_character_id: string | null;
  password_hash: string;
  weapon_counter: number;
}

export function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    locale: row.locale,
    email_verified: row.email_verified,
    verification_email: row.verification_email,
    storage_notice: row.storage_notice,
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || expected === undefined) return false;
  const derived = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function accountById(id: string): Promise<AccountRow | null> {
  return one<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
}

export async function accountByEmail(email: string): Promise<AccountRow | null> {
  return one<AccountRow>('SELECT * FROM accounts WHERE email_lower = $1', [email.toLowerCase()]);
}

export async function accountByDisplayName(name: string): Promise<AccountRow | null> {
  return one<AccountRow>('SELECT * FROM accounts WHERE display_name_lower = $1', [
    name.toLowerCase(),
  ]);
}

export async function createAuthSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO auth_sessions (token, account_id) VALUES ($1, $2)', [token, accountId]);
  return token;
}

export async function accountForAuthToken(token: string): Promise<AccountRow | null> {
  return one<AccountRow>(
    `SELECT a.* FROM auth_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1`,
    [token],
  );
}

export async function deleteAuthSession(token: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE token = $1', [token]);
}

export async function deleteAllAuthSessions(accountId: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE account_id = $1', [accountId]);
}

export async function insertDefaultHero(
  client: PoolClient,
  accountId: string,
  heroName: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO characters (id, account_id, slot, revision, name, parts, proportions, pose, material, accessories)
     VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      accountId,
      heroName,
      JSON.stringify(DEFAULT_PARTS),
      JSON.stringify(DEFAULT_PROPORTIONS),
      JSON.stringify({ right_arm_raise: 0 }),
      DEFAULT_MATERIAL,
      JSON.stringify(DEFAULT_ACCESSORIES),
    ],
  );
  await client.query('UPDATE accounts SET equipped_character_id = $1 WHERE id = $2', [
    id,
    accountId,
  ]);
  return id;
}

export async function setStorageNotice(
  accountId: string,
  notice: StorageNotice,
): Promise<void> {
  await pool.query('UPDATE accounts SET storage_notice = $1 WHERE id = $2', [notice, accountId]);
}
