import { createHash } from 'node:crypto';
import { nowIso } from '../domain/clock.js';
import { ApiError } from '../domain/errors.js';
import { pool } from './pool.js';

/**
 * Idempotency holds and records, decided by the shared database so that a duplicate
 * arriving on any app copy meets the same answer.
 */

const KEY_PATTERN = /^[\x21-\x7e]{1,64}$/;

export interface ReplayedResponse {
  status: number;
  body: unknown;
}

export function requireKey(raw: string | undefined): string {
  if (!raw || !KEY_PATTERN.test(raw)) throw new ApiError('idempotency_key_required');
  return raw;
}

export function fingerprintOf(parts: Array<string | Buffer>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? Buffer.from(part, 'utf8') : part);
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

/**
 * Takes the hold for a key on a method and path, or answers for a request that is a replay,
 * a duplicate in flight, or the same key with different content.
 */
export async function takeHold(
  method: string,
  path: string,
  key: string,
  fingerprint: string,
): Promise<ReplayedResponse | null> {
  const inserted = await pool.query(
    `insert into idempotency (method, path, key, state, fingerprint, created_at)
     values ($1, $2, $3, 'in_flight', $4, $5::timestamptz)
     on conflict (method, path, key) do nothing
     returning key`,
    [method, path, key, fingerprint, nowIso()],
  );
  if (inserted.rowCount === 1) return null;

  const existing = await pool.query<{
    state: 'in_flight' | 'recorded';
    fingerprint: string | null;
    status: number | null;
    body: unknown;
  }>(
    `select state, fingerprint, status, body from idempotency
     where method = $1 and path = $2 and key = $3`,
    [method, path, key],
  );
  const row = existing.rows[0];
  if (!row) return takeHold(method, path, key, fingerprint);
  if (row.state === 'recorded') {
    if (row.fingerprint === fingerprint) {
      return { status: row.status ?? 200, body: row.body };
    }
    throw new ApiError('idempotency_conflict');
  }
  throw new ApiError('idempotency_in_flight');
}

/** Only a success is recorded, and recording it replaces the hold. */
export async function recordSuccess(
  method: string,
  path: string,
  key: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  await pool.query(
    `update idempotency
     set state = 'recorded', fingerprint = $4, status = $5, body = $6::jsonb, created_at = $7::timestamptz
     where method = $1 and path = $2 and key = $3`,
    [method, path, key, fingerprint, status, JSON.stringify(body), nowIso()],
  );
}

/** Any error answer releases the hold and records nothing. */
export async function releaseHold(method: string, path: string, key: string): Promise<void> {
  await pool.query(
    `delete from idempotency where method = $1 and path = $2 and key = $3 and state = 'in_flight'`,
    [method, path, key],
  );
}

/** Recorded keys are kept for 24 hours. */
export async function sweepExpiredKeys(): Promise<void> {
  await pool.query(
    `delete from idempotency where state = 'recorded' and created_at < $1::timestamptz - interval '24 hours'`,
    [nowIso()],
  );
}
