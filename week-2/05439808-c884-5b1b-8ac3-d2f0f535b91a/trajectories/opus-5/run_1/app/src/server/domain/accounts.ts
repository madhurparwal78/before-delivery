import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Queryable } from '../db.js';
import type { AccountRole } from '../../shared/types.js';

/** The library's default algorithm is argon2id. */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

export type Account = {
  id: number;
  email: string;
  emailLower: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: AccountRole;
  trophies: number;
  createdAt: Date;
};

export type AccountRecord = Account & { passwordHash: string };

type AccountDbRow = {
  id: number;
  email: string;
  email_lower: string;
  password_hash: string;
  display_name: string;
  time_zone: string;
  verified: boolean;
  role: string;
  trophies: number;
  created_at: Date;
};

export function mapAccount(row: AccountDbRow): AccountRecord {
  return {
    id: Number(row.id),
    email: row.email,
    emailLower: row.email_lower,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    timeZone: row.time_zone,
    verified: row.verified,
    role: row.role as AccountRole,
    trophies: row.trophies,
    createdAt: row.created_at
  };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function findAccountByEmail(
  client: Queryable,
  email: string
): Promise<AccountRecord | null> {
  const { rows } = await client.query<AccountDbRow>(
    'SELECT * FROM accounts WHERE email_lower = $1',
    [normaliseEmail(email)]
  );
  const row = rows[0];
  return row ? mapAccount(row) : null;
}

export async function findAccountById(
  client: Queryable,
  accountId: number
): Promise<AccountRecord | null> {
  const { rows } = await client.query<AccountDbRow>('SELECT * FROM accounts WHERE id = $1', [
    accountId
  ]);
  const row = rows[0];
  return row ? mapAccount(row) : null;
}

export async function villageIdOf(client: Queryable, accountId: number): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    'SELECT id FROM villages WHERE account_id = $1',
    [accountId]
  );
  const row = rows[0];
  return row ? Number(row.id) : null;
}

export async function clanIdOf(client: Queryable, accountId: number): Promise<number | null> {
  const { rows } = await client.query<{ clan_id: number }>(
    'SELECT clan_id FROM clan_members WHERE account_id = $1',
    [accountId]
  );
  const row = rows[0];
  return row ? Number(row.clan_id) : null;
}
