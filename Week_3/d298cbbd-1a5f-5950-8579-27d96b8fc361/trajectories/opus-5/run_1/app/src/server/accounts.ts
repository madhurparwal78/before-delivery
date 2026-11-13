import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { query, queryOne, transaction } from './db.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export interface Typist {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly verified: boolean;
}

interface TypistRow {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  password_hash: string;
}

export const FIELD_MESSAGES = {
  name: 'Display name must be 1 to 24 characters.',
  email: 'Enter a valid email address.',
  password: 'Password must be at least 10 characters.',
} as const;

export function validName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 24 ? trimmed : null;
}

export function validEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length === 0) return null;
  if (!domain.includes('.')) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function validPassword(password: unknown): string | null {
  if (typeof password !== 'string') return null;
  return password.length >= 10 ? password : null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':') as [string, string?];
  if (!hash) return false;
  const derived = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function toTypist(row: TypistRow): Typist {
  return { id: row.id, email: row.email, name: row.name, verified: row.verified };
}

export async function typistForToken(token: string): Promise<Typist | null> {
  const row = await queryOne<TypistRow>(
    `select t.id, t.email, t.name, t.verified, t.password_hash
       from sessions s join typists t on t.id = s.typist_id
      where s.token = $1`,
    [token],
  );
  return row ? toTypist(row) : null;
}

export async function typistById(id: string): Promise<Typist | null> {
  const row = await queryOne<TypistRow>(
    'select id, email, name, verified, password_hash from typists where id = $1',
    [id],
  );
  return row ? toTypist(row) : null;
}

export async function typistByEmail(email: string): Promise<(Typist & { passwordHash: string }) | null> {
  const row = await queryOne<TypistRow>(
    'select id, email, name, verified, password_hash from typists where email = $1',
    [email],
  );
  return row ? { ...toTypist(row), passwordHash: row.password_hash } : null;
}

export async function createTypist(
  name: string,
  email: string,
  password: string,
  verified = false,
): Promise<Typist> {
  const passwordHash = await hashPassword(password);
  const row = await queryOne<TypistRow>(
    `insert into typists (email, name, password_hash, verified)
     values ($1, $2, $3, $4)
     returning id, email, name, verified, password_hash`,
    [email, name, passwordHash, verified],
  );
  if (!row) throw new Error('typist not created');
  return toTypist(row);
}

export async function replaceTypist(
  id: string,
  name: string,
  password: string,
  verified: boolean,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await query('update typists set name = $2, password_hash = $3, verified = $4 where id = $1', [
    id,
    name,
    passwordHash,
    verified,
  ]);
}

export async function setPassword(typistId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await query('update typists set password_hash = $2 where id = $1', [typistId, passwordHash]);
}

export async function markVerified(typistId: string): Promise<void> {
  await query('update typists set verified = true where id = $1', [typistId]);
}

export async function startSession(typistId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query('insert into sessions (token, typist_id) values ($1, $2)', [token, typistId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export async function endAllSessions(typistId: string): Promise<string[]> {
  const rows = await query<{ token: string }>(
    'delete from sessions where typist_id = $1 returning token',
    [typistId],
  );
  return rows.map((row) => row.token);
}

export type TokenKind = 'verify' | 'reset';

export async function issueEmailToken(typistId: string, kind: TokenKind): Promise<string> {
  const token = randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
  const ttl = kind === 'verify' ? config.verifyTtlSeconds : config.resetTtlSeconds;
  await query(
    `insert into email_tokens (token, typist_id, kind, expires_at)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [token, typistId, kind, String(ttl)],
  );
  return token;
}

/** Spends a single-use token. Returns the typist id, or null when unknown, used or expired. */
export async function spendEmailToken(token: unknown, kind: TokenKind): Promise<string | null> {
  if (typeof token !== 'string' || token === '') return null;
  const row = await queryOne<{ typist_id: string }>(
    `update email_tokens set used_at = now()
      where token = $1 and kind = $2 and used_at is null and expires_at > now()
      returning typist_id`,
    [token, kind],
  );
  return row ? row.typist_id : null;
}

export interface SignInOutcome {
  readonly kind: 'ok' | 'invalid' | 'limited';
  readonly typist?: Typist;
  readonly retryAfter?: number;
}

const SIGN_IN_WINDOW_SECONDS = 60;
const SIGN_IN_LIMIT = 5;

function emailLockKey(email: string): number {
  let hash = 0;
  for (const character of email) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return hash;
}

/**
 * Counts failures per email exactly: the advisory lock serialises parallel attempts for one
 * email, so five of twelve wrong passwords are 401 and the rest are 429.
 */
export async function attemptSignIn(email: string, password: string): Promise<SignInOutcome> {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1, $2)', [1, emailLockKey(email)]);
    const failures = await client.query<{ at: Date }>(
      `select at from sign_in_failures
        where email = $1 and at > now() - ($2 || ' seconds')::interval
        order by at asc`,
      [email, String(SIGN_IN_WINDOW_SECONDS)],
    );
    if (failures.rowCount !== null && failures.rowCount >= SIGN_IN_LIMIT) {
      const oldest = failures.rows[0]?.at ?? new Date();
      const retryAfter = Math.max(
        1,
        Math.ceil((oldest.getTime() + SIGN_IN_WINDOW_SECONDS * 1000 - Date.now()) / 1000),
      );
      return { kind: 'limited', retryAfter } satisfies SignInOutcome;
    }
    const found = await client.query<TypistRow>(
      'select id, email, name, verified, password_hash from typists where email = $1',
      [email],
    );
    const row = found.rows[0];
    if (row && (await passwordMatches(password, row.password_hash))) {
      return { kind: 'ok', typist: toTypist(row) } satisfies SignInOutcome;
    }
    await client.query('insert into sign_in_failures (email) values ($1)', [email]);
    return { kind: 'invalid' } satisfies SignInOutcome;
  });
}
