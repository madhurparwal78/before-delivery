import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import type { MemberRow } from '../db/records.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'scrypt' || !saltPart || !hashPart) return false;
  const derived = await scryptAsync(password, Buffer.from(saltPart, 'base64'), KEY_LENGTH);
  const expected = Buffer.from(hashPart, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createAuthSession(tx: PoolClient, memberId: string): Promise<string> {
  const token = randomToken(32);
  await tx.query(
    `insert into auth_sessions (token, member_id, created_at, expires_at)
     values ($1, $2, now(), now() + ($3 || ' seconds')::interval)`,
    [token, memberId, String(config.sessionTtlSeconds)],
  );
  return token;
}

export async function memberForSessionToken(token: string): Promise<MemberRow | null> {
  const result = await pool.query<MemberRow>(
    `select m.* from auth_sessions s
       join members m on m.id = s.member_id
      where s.token = $1 and s.expires_at > now() and m.status <> 'removed'`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function endAuthSession(token: string): Promise<void> {
  await pool.query('delete from auth_sessions where token = $1', [token]);
}

export function newId(): string {
  return randomUUID();
}
