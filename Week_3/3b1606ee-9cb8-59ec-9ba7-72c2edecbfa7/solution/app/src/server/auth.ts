import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { one, query, type Queryable } from './db.js';
import { parseCookies } from './http.js';
import type { AccountRow } from './rows.js';

const SESSION_COOKIE = 'airfold_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** The verifier is stored only as a salted SHA-256 hash. */
export function hashVerifier(salt: Buffer, verifier: Buffer): Buffer {
  return sha256(salt, verifier);
}

export function verifierMatches(account: AccountRow, verifier: Buffer): boolean {
  return timingSafeEqual(hashVerifier(account.recovery_salt, verifier), account.recovery_hash);
}

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

export async function createSession(db: Queryable, accountId: string, at: Date): Promise<{ token: string; hash: Buffer }> {
  const token = randomBytes(32).toString('base64url');
  const hash = sha256(Buffer.from(token));
  await query(db, 'INSERT INTO sessions (token_hash, account_id, created_at) VALUES ($1, $2, $3)', [hash, accountId, at]);
  return { token, hash };
}

export async function sessionFor(db: Queryable, req: IncomingMessage): Promise<{ account: AccountRow; hash: Buffer } | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const hash = sha256(Buffer.from(token));
  const account = await one<AccountRow>(
    db,
    'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1',
    [hash],
  );
  return account ? { account, hash } : null;
}

export async function revokeOtherSessions(db: Queryable, accountId: string, keep: Buffer): Promise<void> {
  await query(db, 'DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, keep]);
}
