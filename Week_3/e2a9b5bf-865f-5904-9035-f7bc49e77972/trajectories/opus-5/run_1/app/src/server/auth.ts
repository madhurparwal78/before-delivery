import { randomBytes, randomUUID } from 'node:crypto';
import type { Account } from '../shared/types.js';
import { config } from './config.js';
import { pool, query, withTransaction } from './db.js';
import { ApiError, FieldErrors, unauthenticated } from './errors.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  clearFailures,
  lockEmailForAttempt,
  recordFailure,
  remainingLockSeconds,
} from './signin-lock.js';

export const SESSION_COOKIE = 'lowlamp_session';

/** Emails are compared and stored trimmed and lowercased. */
export function normaliseEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function emailLooksValid(email: string): boolean {
  if (email.length === 0 || email.length > 320) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  return at > 0 && at < email.length - 1 && !email.includes('@', at + 1);
}

/** Display names are 1 to 60 characters, with no control or line-separator characters. */
export function validateDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return null;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(trimmed)) return null;
  return trimmed;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, email: row.email, display_name: row.display_name };
}

export interface SignedInAccount extends Account {
  session_id: string;
}

export async function accountForSession(sessionId: string | undefined): Promise<SignedInAccount | null> {
  if (!sessionId) return null;
  const found = await query<AccountRow & { session_id: string }>(
    `SELECT a.id, a.email, a.display_name, a.password_hash, s.id AS session_id
     FROM signin_sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  const row = found.rows[0];
  return row ? { ...toAccount(row), session_id: row.session_id } : null;
}

async function startSession(accountId: string): Promise<string> {
  const id = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO signin_sessions (id, account_id, expires_at)
     VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
    [id, accountId, config.signinSessionSeconds],
  );
  return id;
}

export function sessionCookie(sessionId: string): string {
  return (
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${config.signinSessionSeconds}`
  );
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export interface SignUpResult {
  account: Account;
  sessionId: string;
}

export async function signUp(body: Record<string, unknown>): Promise<SignUpResult> {
  const email = normaliseEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = validateDisplayName(body.display_name);
  const errors = new FieldErrors();
  if (!emailLooksValid(email)) errors.add('email');
  if (password.length < 10) errors.add('password');
  if (displayName === null) errors.add('display_name');
  errors.throwIfAny();

  const id = randomUUID();
  const inserted = await query<{ id: string }>(
    `INSERT INTO accounts (id, email, password_hash, display_name)
     VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id`,
    [id, email, await hashPassword(password), displayName],
  );
  if (inserted.rowCount === 0) throw new ApiError(409, 'email_taken');
  await query(
    `INSERT INTO packet_counters (account_id, next_number) VALUES ($1,1)
     ON CONFLICT (account_id) DO NOTHING`,
    [id],
  );
  return {
    account: { id, email, display_name: displayName as string },
    sessionId: await startSession(id),
  };
}

type Attempt =
  | { outcome: 'locked'; retryAfter: number }
  | { outcome: 'bad_credentials' }
  | { outcome: 'signed_in'; account: Account };

export async function signIn(body: Record<string, unknown>): Promise<SignUpResult> {
  const email = normaliseEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  // The attempt commits its own record, so a refusal still counts.
  const attempt = await withTransaction<Attempt>(async (client) => {
    await lockEmailForAttempt(client, email);
    const retryAfter = await remainingLockSeconds(client, email);
    if (retryAfter !== null) return { outcome: 'locked', retryAfter };
    const found = await client.query<AccountRow>(
      'SELECT id, email, display_name, password_hash FROM accounts WHERE email = $1',
      [email],
    );
    const row = found.rows[0];
    const matched = row ? await verifyPassword(password, row.password_hash) : false;
    if (!row || !matched) {
      await recordFailure(client, email);
      return { outcome: 'bad_credentials' };
    }
    await clearFailures(client, email);
    return { outcome: 'signed_in', account: toAccount(row) };
  });

  if (attempt.outcome === 'locked') {
    throw new ApiError(429, 'too_many_attempts', { __retryAfter: attempt.retryAfter });
  }
  if (attempt.outcome === 'bad_credentials') throw new ApiError(401, 'bad_credentials');
  return { account: attempt.account, sessionId: await startSession(attempt.account.id) };
}

export async function signOut(sessionId: string | undefined): Promise<void> {
  if (sessionId) await query('DELETE FROM signin_sessions WHERE id = $1', [sessionId]);
}

export async function requireAccount(sessionId: string | undefined): Promise<SignedInAccount> {
  const account = await accountForSession(sessionId);
  if (!account) throw unauthenticated();
  return account;
}

export async function removeExpiredSessions(): Promise<void> {
  await pool.query('DELETE FROM signin_sessions WHERE expires_at < now()').catch(() => undefined);
}
