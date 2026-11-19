/** Accounts, password hashing and expiring sessions. */

import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db';
import { query, queryOne } from '../db';
import { now, plusSeconds } from '../clock';
import { config } from '../config';
import type { Account, AccountRole } from '../../shared/types';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  password_hash: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), KEY_LENGTH);
  const expected = Buffer.from(digest, 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createAccountIfNew(
  db: Db,
  input: { name: string; email: string; password: string },
): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  await query(
    db,
    `insert into accounts (id, email, name, password_hash, role, created_at)
     values ($1, $2, $3, $4, 'buyer', $5)
     on conflict (email) do nothing`,
    [randomUUID(), normaliseEmail(input.email), input.name.trim(), passwordHash, now()],
  );
}

export async function findAccountByEmail(db: Db, email: string): Promise<AccountRow | null> {
  return queryOne<AccountRow>(db, 'select id, email, name, role, password_hash from accounts where email = $1', [
    normaliseEmail(email),
  ]);
}

export async function signIn(db: Db, email: string, password: string): Promise<AccountRecord | null> {
  const row = await findAccountByEmail(db, email);
  if (!row) {
    // Keep the cost of an unknown address the same as a wrong password.
    await scrypt(password, Buffer.alloc(16), KEY_LENGTH);
    return null;
  }
  if (!(await passwordMatches(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function startSession(db: Db, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const createdAt = now();
  await query(db, 'insert into sessions (token, account_id, created_at, expires_at) values ($1, $2, $3, $4)', [
    token,
    accountId,
    createdAt,
    plusSeconds(createdAt, config.sessionSeconds),
  ]);
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await query(db, 'delete from sessions where token = $1', [token]);
}

export async function accountForSession(db: Db, token: string | null): Promise<AccountRecord | null> {
  if (!token) return null;
  const row = await queryOne<AccountRow>(
    db,
    `select a.id, a.email, a.name, a.role, a.password_hash
       from sessions s join accounts a on a.id = s.account_id
      where s.token = $1 and s.expires_at > $2`,
    [token, now()],
  );
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;
}

export function publicAccount(account: AccountRecord): Account {
  return { email: account.email, name: account.name, role: account.role };
}
