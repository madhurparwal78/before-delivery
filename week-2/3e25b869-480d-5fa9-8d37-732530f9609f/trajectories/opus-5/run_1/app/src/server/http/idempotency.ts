import { createHash } from 'node:crypto';
import { db } from '../db/pool.js';
import type { ApiResponse, RequestContext } from './context.js';
import { ApiError, errors } from './errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const STORED_STATUSES = new Set([409, 410, 412, 422]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

function isStorable(status: number): boolean {
  return (status >= 200 && status < 300) || STORED_STATUSES.has(status);
}

/**
 * Replays a stored response for the same key and body, refuses a different body, and never stores a
 * 5xx so a retry after an outage runs fresh.
 */
export async function runIdempotent(
  ctx: RequestContext,
  route: string,
  scope: string,
  work: () => Promise<ApiResponse>,
): Promise<ApiResponse> {
  const key = ctx.header('idempotency-key');
  if (key === undefined || key === '') throw errors.idempotencyKeyRequired();
  if (!KEY_PATTERN.test(key)) throw errors.idempotencyKeyInvalid();
  const bodyHash = createHash('sha256').update(canonical(ctx.body ?? null)).digest('hex');

  const claim = await db.query(
    `INSERT INTO idempotency_records (route, scope, key, body_hash, state)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (route, scope, key) DO NOTHING`,
    [route, scope, key, bodyHash],
  );

  if (claim.rowCount === 0) {
    const existing = await db.query<{
      body_hash: string;
      state: string;
      status: number | null;
      response: unknown;
    }>(
      `SELECT body_hash, state, status, response FROM idempotency_records
        WHERE route = $1 AND scope = $2 AND key = $3`,
      [route, scope, key],
    );
    const record = existing.rows[0];
    if (!record) throw errors.requestInProgress();
    if (record.body_hash !== bodyHash) throw errors.idempotencyKeyReused();
    if (record.state === 'in_progress') throw errors.requestInProgress();
    return {
      status: record.status ?? 200,
      body: record.response,
      headers: { 'Idempotent-Replayed': 'true' },
    };
  }

  const forget = async (): Promise<void> => {
    await db
      .query('DELETE FROM idempotency_records WHERE route = $1 AND scope = $2 AND key = $3', [
        route,
        scope,
        key,
      ])
      .catch(() => undefined);
  };

  const store = async (status: number, body: unknown): Promise<void> => {
    await db.query(
      `UPDATE idempotency_records SET state = 'done', status = $4, response = $5
        WHERE route = $1 AND scope = $2 AND key = $3`,
      [route, scope, key, status, JSON.stringify(body ?? null)],
    );
  };

  try {
    const result = await work();
    if (isStorable(result.status)) await store(result.status, result.body ?? null);
    else await forget();
    return result;
  } catch (error) {
    if (error instanceof ApiError && isStorable(error.status)) {
      await store(error.status, error.body(ctx.locale));
    } else {
      await forget();
    }
    throw error;
  }
}

export async function purgeExpiredIdempotencyRecords(seconds: number): Promise<void> {
  await db
    .query(`DELETE FROM idempotency_records WHERE created_at < now() - ($1 || ' seconds')::interval`, [
      String(seconds),
    ])
    .catch(() => undefined);
}
