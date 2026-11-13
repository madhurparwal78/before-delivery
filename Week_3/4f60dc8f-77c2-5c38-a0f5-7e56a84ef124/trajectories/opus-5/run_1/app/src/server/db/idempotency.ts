import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError, fail } from '../http/app-error.js';
import { query } from './pool.js';

export type StoredOutcome = { status: number; body: unknown };

export type Claim =
  | { kind: 'claimed' }
  | { kind: 'stored'; outcome: StoredOutcome };

const bodyHash = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

/**
 * The idempotency rule, decided before every other 409: an in-flight key answers
 * `request_in_progress`, an identical replay returns its stored response, and the same key
 * with a different body answers `idempotency_conflict`.
 */
export const claimIdempotency = async (
  scope: string,
  key: string,
  body: unknown,
): Promise<Claim> => {
  const hash = bodyHash(body);
  const inserted = await query(
    `INSERT INTO idempotency_records (id, scope, key, request_hash, state, expires_at)
     VALUES ($1, $2, $3, $4, 'in_flight', now() + ($5::text || ' seconds')::interval)
     ON CONFLICT (scope, key) DO NOTHING`,
    [randomUUID(), scope, key, hash, String(config.idempotencyKeyTtlSeconds)],
  );
  if (inserted.rowCount === 1) return { kind: 'claimed' };

  const existing = (
    await query<{ request_hash: string; state: string; status: number | null; response: unknown }>(
      'SELECT request_hash, state, status, response FROM idempotency_records WHERE scope = $1 AND key = $2',
      [scope, key],
    )
  ).rows[0];
  if (existing === undefined) return claimIdempotency(scope, key, body);
  if (existing.request_hash !== hash) fail('idempotency_conflict');
  if (existing.state === 'in_flight') fail('request_in_progress');
  return {
    kind: 'stored',
    outcome: { status: existing.status ?? 200, body: existing.response },
  };
};

export const storeOutcome = async (
  scope: string,
  key: string,
  outcome: StoredOutcome,
): Promise<void> => {
  await query(
    "UPDATE idempotency_records SET state = 'done', status = $3, response = $4::jsonb WHERE scope = $1 AND key = $2",
    [scope, key, outcome.status, JSON.stringify(outcome.body)],
  );
};

/** 503 outcomes are not stored, so retrying after an outage runs the action. */
export const releaseClaim = async (scope: string, key: string): Promise<void> => {
  await query("DELETE FROM idempotency_records WHERE scope = $1 AND key = $2 AND state = 'in_flight'", [
    scope,
    key,
  ]);
};

export const settleClaim = async (
  scope: string,
  key: string,
  run: () => Promise<StoredOutcome>,
): Promise<StoredOutcome> => {
  try {
    const outcome = await run();
    await storeOutcome(scope, key, outcome);
    return outcome;
  } catch (error) {
    if (error instanceof AppError && error.code === 'card_declined') {
      await storeOutcome(scope, key, {
        status: error.status,
        body: { error: error.code, message: error.message },
      });
      throw error;
    }
    await releaseClaim(scope, key);
    throw error;
  }
};
