/**
 * Sessions, reference locks, rate windows and idempotency records. All of it lives in
 * Postgres, so every copy of the desk sees the same state and nothing is held in process
 * memory between requests.
 */

import { createHash } from 'node:crypto';

import { config } from '../config';
import { newToken } from '../domain/references';
import { query, queryOne, withTransaction, type Transaction } from './pool';

/* ------------------------------------------------------------------- operator sessions */

export interface SignedInOperator {
  operatorId: number;
  email: string;
}

export async function findOperator(email: string): Promise<{ id: number; email: string; passwordHash: string } | null> {
  const row = await queryOne<{ id: string; email: string; password_hash: string }>(
    'SELECT id::text, email, password_hash FROM operators WHERE lower(email) = lower($1)',
    [email],
  );
  return row === null ? null : { id: Number(row.id), email: row.email, passwordHash: row.password_hash };
}

/** A session lasts `OPERATOR_SESSION_SECONDS` from sign-in. */
export async function openSession(operatorId: number, now: Date): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + config.operatorSessionSeconds * 1000);
  await query('INSERT INTO operator_sessions (token, operator_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    token,
    operatorId,
    now,
    expiresAt,
  ]);
  return token;
}

/** A session made on one copy works on every copy that shares its database. */
export async function liveSession(token: string, now: Date): Promise<SignedInOperator | null> {
  const row = await queryOne<{ operator_id: string; email: string }>(
    `SELECT s.operator_id::text, o.email
       FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
      WHERE s.token = $1 AND s.expires_at > $2`,
    [token, now],
  );
  return row === null ? null : { operatorId: Number(row.operator_id), email: row.email };
}

export async function closeSession(token: string): Promise<void> {
  await query('DELETE FROM operator_sessions WHERE token = $1', [token]);
}

/* --------------------------------------------------------------------- reference locks */

export type LockVerdict = { locked: true; retryAfter: number } | { locked: false };

interface LockRow {
  wrong_tries: number;
  locked_at: Date | null;
}

function lockEndsAt(lockedAt: Date): number {
  return lockedAt.getTime() + config.referenceLockSeconds * 1000;
}

/**
 * While the lock lasts every lookup of that reference is refused, including one with the
 * right email. A lock that has run out resets the count, so the next try is judged normally.
 */
export async function referenceLockVerdict(reference: string, now: Date): Promise<LockVerdict> {
  return withTransaction(async (tx) => {
    const row = await tx.queryOne<LockRow>(
      'SELECT wrong_tries, locked_at FROM reference_locks WHERE reference = $1 FOR UPDATE',
      [reference],
    );
    if (row === null || row.locked_at === null) return { locked: false };

    const remaining = lockEndsAt(row.locked_at) - now.getTime();
    if (remaining <= 0) {
      await tx.query('DELETE FROM reference_locks WHERE reference = $1', [reference]);
      return { locked: false };
    }
    const retryAfter = Math.min(Math.max(Math.ceil(remaining / 1000), 1), config.referenceLockSeconds);
    return { locked: true, retryAfter };
  });
}

/** Each wrong try counts against the reference named in the request. The 5th starts the lock. */
export async function countWrongTry(reference: string, now: Date): Promise<void> {
  await query(
    `INSERT INTO reference_locks (reference, wrong_tries, locked_at)
     VALUES ($1, 1, NULL)
     ON CONFLICT (reference) DO UPDATE
       SET wrong_tries = reference_locks.wrong_tries + 1,
           locked_at = CASE WHEN reference_locks.wrong_tries + 1 >= 5 THEN $2 ELSE reference_locks.locked_at END`,
    [reference, now],
  );
}

export async function clearWrongTries(reference: string): Promise<void> {
  await query('DELETE FROM reference_locks WHERE reference = $1', [reference]);
}

/* ------------------------------------------------------------------------- rate windows */

export type RateVerdict = { limited: true; retryAfter: number } | { limited: false };

const RATE_WINDOW_MS = 60_000;

/** Counted per caller connection address across every copy that shares the database. */
export async function rateVerdict(caller: string, now: Date): Promise<RateVerdict> {
  if (config.partsRateLimitPerMinute === 0) return { limited: true, retryAfter: 60 };

  return withTransaction(async (tx) => {
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);
    await tx.query('DELETE FROM rate_windows WHERE at < $1', [windowStart]);
    const rows = await tx.query<{ at: Date }>(
      'SELECT at FROM rate_windows WHERE caller = $1 AND at >= $2 ORDER BY at',
      [caller, windowStart],
    );
    if (rows.length >= config.partsRateLimitPerMinute) {
      const oldest = rows[0]!.at.getTime();
      const retryAfter = Math.max(Math.ceil((oldest + RATE_WINDOW_MS - now.getTime()) / 1000), 1);
      return { limited: true, retryAfter };
    }
    await tx.query('INSERT INTO rate_windows (caller, at) VALUES ($1, $2)', [caller, now]);
    return { limited: false };
  });
}

/* --------------------------------------------------------------- idempotency records */

const KEY_PATTERN = /^[!-~]{1,64}$/;

/** A key is made of visible ASCII characters, 1 to 64 of them. */
export function isIdempotencyKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function bodyFingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

export interface StoredResponse {
  status: number;
  body: string;
}

export type ReplayVerdict =
  | { kind: 'fresh' }
  | { kind: 'replay'; stored: StoredResponse }
  | { kind: 'conflict' };

/**
 * One key means one action with one body on that claim. The same key on another claim is a
 * fresh, independent action, never a conflict.
 */
export async function replayVerdict(
  tx: Transaction,
  reference: string,
  key: string,
  action: string,
  fingerprint: string,
): Promise<ReplayVerdict> {
  const row = await tx.queryOne<{ action: string; body_hash: string; status: number; response_body: string }>(
    'SELECT action, body_hash, status, response_body FROM idempotency_records WHERE reference = $1 AND idem_key = $2',
    [reference, key],
  );
  if (row === null) return { kind: 'fresh' };
  if (row.action !== action || row.body_hash !== fingerprint) return { kind: 'conflict' };
  return { kind: 'replay', stored: { status: row.status, body: row.response_body } };
}

/** Only 200 responses are stored, so a failed attempt leaves its key unused. */
export async function storeResponse(
  tx: Transaction,
  reference: string,
  key: string,
  action: string,
  fingerprint: string,
  stored: StoredResponse,
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO idempotency_records (reference, idem_key, action, body_hash, status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (reference, idem_key) DO NOTHING`,
    [reference, key, action, fingerprint, stored.status, stored.body, now],
  );
}
