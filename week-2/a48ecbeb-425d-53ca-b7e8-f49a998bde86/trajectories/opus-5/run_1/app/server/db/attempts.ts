import crypto from 'node:crypto';
import { query, queryOne, transaction } from './pool.js';

export type AttemptScope = 'checkout' | 'refund';

export interface StoredAttempt {
  status: number;
  body: unknown;
}

export type AttemptClaim =
  | { outcome: 'claimed' }
  | { outcome: 'stored'; stored: StoredAttempt }
  | { outcome: 'mismatch' }
  | { outcome: 'running' };

export function hashBody(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Claims an attempt key for this request, or reports the stored response of a
 * finished attempt, a mismatching body, or a first request still running.
 */
export async function claimAttempt(
  scope: AttemptScope,
  userId: string,
  key: string,
  bodyHash: string,
): Promise<AttemptClaim> {
  return transaction(async (tx) => {
    const inserted = await tx.execute(
      `insert into attempt_keys (scope, user_id, key, body_hash, state)
       values ($1, $2, $3, $4, 'running')
       on conflict (scope, user_id, key) do nothing`,
      [scope, userId, key, bodyHash],
    );
    if (inserted === 1) return { outcome: 'claimed' };

    const rows = await tx.query<{
      body_hash: string;
      state: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      'select body_hash, state, response_status, response_body from attempt_keys where scope = $1 and user_id = $2 and key = $3 for update',
      [scope, userId, key],
    );
    const existing = rows[0]!;
    if (existing.body_hash !== bodyHash) return { outcome: 'mismatch' };
    if (existing.state === 'done' && existing.response_status !== null) {
      return {
        outcome: 'stored',
        stored: { status: existing.response_status, body: existing.response_body },
      };
    }
    return { outcome: 'running' };
  });
}

/** A 503 is never stored, so retrying the same key after the service returns completes it. */
export async function finishAttempt(
  scope: AttemptScope,
  userId: string,
  key: string,
  stored: StoredAttempt,
): Promise<void> {
  await query(
    `update attempt_keys
        set state = 'done', response_status = $4, response_body = $5
      where scope = $1 and user_id = $2 and key = $3`,
    [scope, userId, key, stored.status, JSON.stringify(stored.body)],
  );
}

export async function abandonAttempt(
  scope: AttemptScope,
  userId: string,
  key: string,
): Promise<void> {
  await query('delete from attempt_keys where scope = $1 and user_id = $2 and key = $3', [
    scope,
    userId,
    key,
  ]);
}

export async function readFinishedAttempt(
  scope: AttemptScope,
  userId: string,
  key: string,
): Promise<StoredAttempt | null> {
  const row = await queryOne<{ state: string; response_status: number | null; response_body: unknown }>(
    'select state, response_status, response_body from attempt_keys where scope = $1 and user_id = $2 and key = $3',
    [scope, userId, key],
  );
  if (row === null || row.state !== 'done' || row.response_status === null) return null;
  return { status: row.response_status, body: row.response_body };
}

export async function forgetExpiredAttempts(): Promise<void> {
  await query("delete from attempt_keys where created_at < now() - interval '24 hours'");
}
