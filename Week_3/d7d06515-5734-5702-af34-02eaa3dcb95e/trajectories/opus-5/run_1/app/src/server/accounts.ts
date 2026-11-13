import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { STUDIO_TIME_ZONES } from '../shared/api';
import { copy } from '../shared/copy';
import { config } from './config';
import { one, query } from './db';
import { ApiError, fail, ValidationError } from './errors';
import { studioToday, trialState, workspaceNow, type TrialState, type WorkspaceRecord } from './clock';
import { formatIsoDate } from '../shared/format';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export interface UserRecord {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  password_hash: string;
  verified: boolean;
  confirmed_on: string | null;
  created_at: Date;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, digest] = stored.split('$');
  if (salt === undefined || digest === undefined) return false;
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), 32);
  const expected = Buffer.from(digest, 'base64url');
  return derived.byteLength === expected.byteLength && crypto.timingSafeEqual(derived, expected);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function validateSignup(body: Record<string, unknown>): {
  name: string;
  email: string;
  password: string;
  timeZone: string;
} {
  const errors: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const timeZone = typeof body.time_zone === 'string' ? body.time_zone : 'UTC';
  if (name.length < 1 || name.length > 80) errors.name = copy.account.nameError;
  if (!EMAIL_PATTERN.test(email)) errors.email = copy.account.emailError;
  if (password.length < 10) errors.password = copy.account.passwordError;
  if (!(STUDIO_TIME_ZONES as readonly string[]).includes(timeZone)) errors.time_zone = copy.account.timeZoneError;
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { name, email, password, timeZone };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return await one<UserRecord>('select * from users where lower(email) = lower($1)', [email]);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return await one<UserRecord>('select * from users where id = $1', [id]);
}

export async function findWorkspace(id: string): Promise<WorkspaceRecord | null> {
  return await one<WorkspaceRecord>('select * from workspaces where id = $1', [id]);
}

export async function createVerifyToken(userId: string, now: Date): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('insert into verify_tokens (token, user_id, created_at) values ($1,$2,$3)', [token, userId, now]);
  return token;
}

export interface VerifyTokenRecord {
  token: string;
  user_id: string;
  created_at: Date;
  seq: number;
}

export async function findVerifyToken(token: string): Promise<VerifyTokenRecord | null> {
  return await one<VerifyTokenRecord>('select * from verify_tokens where token = $1', [token]);
}

export async function newerTokenExists(record: VerifyTokenRecord): Promise<boolean> {
  const rows = await query<{ seq: number }>(
    'select seq from verify_tokens where user_id = $1 and seq > $2 limit 1',
    [record.user_id, record.seq],
  );
  return rows.length > 0;
}

/** A confirmation link is expired at or after its creation plus the published lifetime. */
export function verifyLinkExpired(record: VerifyTokenRecord, now: Date): boolean {
  return now.getTime() - record.created_at.getTime() >= config.verifyLinkSeconds * 1000;
}

export async function markVerified(userId: string, workspace: WorkspaceRecord): Promise<void> {
  await query('update users set verified = true, confirmed_on = $2 where id = $1', [
    userId,
    studioToday(workspace),
  ]);
}

export async function createSession(userId: string, now: Date): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('insert into sessions (token, user_id, created_at) values ($1,$2,$3)', [token, userId, now]);
  return token;
}

export async function findSessionUser(token: string): Promise<UserRecord | null> {
  return await one<UserRecord>(
    'select u.* from sessions s join users u on u.id = s.user_id where s.token = $1',
    [token],
  );
}

export async function dropSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

interface AttemptRecord {
  email: string;
  failures: number;
  lock_until: Date | null;
}

export async function signinLockSeconds(email: string, now: Date): Promise<number> {
  const record = await one<AttemptRecord>('select * from signin_attempts where lower(email) = lower($1)', [email]);
  if (record === null || record.lock_until === null) return 0;
  const remaining = Math.ceil((record.lock_until.getTime() - now.getTime()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * The failure that reaches the published count starts the lock, so that failure is itself
 * refused as locked. Returns the remaining lock time in seconds, or 0 when not locked.
 */
export async function recordSigninFailure(email: string, now: Date): Promise<number> {
  const rows = await query<AttemptRecord>(
    `insert into signin_attempts (email, failures, lock_until) values (lower($1), 1, null)
     on conflict (email) do update set failures = signin_attempts.failures + 1 returning *`,
    [email],
  );
  const record = rows[0]!;
  if (record.failures < config.signinMaxFailures) return 0;
  await query('update signin_attempts set lock_until = $2, failures = 0 where email = lower($1)', [
    email,
    new Date(now.getTime() + config.signinLockSeconds * 1000),
  ]);
  return config.signinLockSeconds;
}

export async function clearSigninFailures(email: string): Promise<void> {
  await query('delete from signin_attempts where lower(email) = lower($1)', [email]);
}

export interface Caller {
  user: UserRecord;
  workspace: WorkspaceRecord;
  now: Date;
  trial: TrialState;
}

export async function callerFromSession(token: string | undefined): Promise<Caller | null> {
  if (token === undefined) return null;
  const user = await findSessionUser(token);
  if (user === null) return null;
  const workspace = await findWorkspace(user.workspace_id);
  if (workspace === null) return null;
  return {
    user,
    workspace,
    now: workspaceNow(workspace),
    trial: trialState(user.confirmed_on, workspace),
  };
}

export function requireCaller(caller: Caller | null): Caller {
  if (caller === null) fail('unauthenticated');
  return caller;
}

export interface QuoteRecord {
  number: string;
  amount: string;
  currency: string;
  sent_to: string;
}

/** Quote numbers are `Q-<YYYYMMDD>-<4-digit sequence>`, restarting each studio day. */
export async function nextQuoteNumber(workspace: WorkspaceRecord, now: Date): Promise<{ number: string; seq: number; date: string }> {
  const date = formatIsoDate(now, workspace.time_zone);
  const rows = await query<{ next: number }>(
    'select coalesce(max(seq), 0) + 1 as next from quotes where workspace_id = $1 and issue_date = $2',
    [workspace.id, date],
  );
  const seq = rows[0]?.next ?? 1;
  return { number: `Q-${date.replaceAll('-', '')}-${String(seq).padStart(4, '0')}`, seq, date };
}

export function assertNotLocked(remaining: number): void {
  if (remaining > 0) throw new ApiError('signin_locked', { retry_after_seconds: remaining });
}
