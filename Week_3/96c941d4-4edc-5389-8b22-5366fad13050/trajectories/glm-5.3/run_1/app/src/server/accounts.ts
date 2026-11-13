import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { withClient, withTransaction } from './db.js';

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export interface AccountRow {
  id: string;
  email: string;
  player_name: string;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 32);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const computed = await scrypt(password, salt, 32);
  const expected = Buffer.from(key, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export interface AccountOutcome {
  kind: 'created' | 'duplicate';
  account?: AccountRow;
}

export async function createAccount(email: string, password: string, playerName: string): Promise<AccountOutcome> {
  const normalized = normalizeEmail(email);
  const hash = await hashPassword(password);
  const id = newId('acct');
  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        'INSERT INTO accounts (id, email_normalized, email, player_name, password_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email_normalized) DO NOTHING RETURNING id, email, player_name',
        [id, normalized, email.trim(), playerName.trim(), hash],
      );
      if (result.rowCount === 0) return { kind: 'duplicate' as const };
      return { kind: 'created' as const, account: result.rows[0] as AccountRow };
    });
  } catch (e) {
    const message = String(e);
    if (message.includes('duplicate key')) return { kind: 'duplicate' };
    throw e;
  }
}

export async function authenticate(email: string, password: string): Promise<AccountRow | null> {
  const normalized = normalizeEmail(email);
  return withClient(async (client) => {
    const result = await client.query('SELECT id, email, player_name, password_hash FROM accounts WHERE email_normalized = $1', [normalized]);
    const row = result.rows[0];
    if (!row) return null;
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return null;
    return { id: row.id, email: row.email, player_name: row.player_name } as AccountRow;
  });
}

export function sessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(accountId: string): Promise<string> {
  const token = sessionToken();
  await withClient(async (client) => {
    await client.query('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [tokenHash(token), accountId]);
  });
  return token;
}

export async function resolveSession(token: string): Promise<AccountRow | null> {
  if (!token) return null;
  return withClient(async (client) => {
    const result = await client.query(
      'SELECT a.id, a.email, a.player_name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1',
      [tokenHash(token)],
    );
    return (result.rows[0] as AccountRow) ?? null;
  });
}

export async function revokeSession(token: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  });
}

export async function accountById(client: Client, id: string): Promise<AccountRow | null> {
  const result = await client.query('SELECT id, email, player_name FROM accounts WHERE id = $1', [id]);
  return (result.rows[0] as AccountRow) ?? null;
}

export { newId };
