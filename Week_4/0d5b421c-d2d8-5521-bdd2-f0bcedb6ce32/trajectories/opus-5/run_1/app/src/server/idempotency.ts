import { pool, query } from './db';
import { ApiError, errors } from './errors';

export interface ActionOutcome {
  status: number;
  body: unknown;
}

const STORED_ERROR_STATUSES = new Set([404, 409, 410, 422]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function readIdempotencyKey(header: string | undefined): string {
  if (header === undefined) throw errors.idempotencyKeyRequired();
  const key = header.trim();
  if (key.length < 1 || key.length > 64 || !/^[\x21-\x7e]+$/.test(key)) {
    throw errors.idempotencyKeyRequired();
  }
  return key;
}

interface RecordRow {
  method: string;
  path: string;
  body: unknown;
  status: number | null;
  response: unknown;
  completed: boolean;
}

/**
 * The one place idempotent replay is handled, for confirm, cancel, claim and walk-in.
 * Requests with the same key wait for each other; a stored final outcome is replayed before
 * any 404 or 410 check.
 */
export async function withIdempotency(
  key: string,
  method: string,
  path: string,
  body: unknown,
  run: () => Promise<ActionOutcome>,
  /** A resource to take in turn as well, so claims on one offer are handled one at a time. */
  lock?: string,
): Promise<ActionOutcome> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [key]);
    if (lock !== undefined) {
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [lock]);
    }
    await query(
      client,
      `insert into idempotency_records(key, method, path, body) values ($1, $2, $3, $4::jsonb)
       on conflict (key) do nothing`,
      [key, method, path, JSON.stringify(body ?? {})],
    );
    const found = await query<RecordRow>(
      client,
      'select method, path, body, status, response, completed from idempotency_records where key = $1',
      [key],
    );
    const record = found.rows[0];
    if (!record) throw new Error('Idempotency record disappeared');
    if (
      record.method !== method ||
      record.path !== path ||
      canonical(record.body) !== canonical(body ?? {})
    ) {
      throw errors.idempotencyConflict();
    }
    if (record.completed && record.status !== null) {
      return { status: record.status, body: record.response };
    }

    try {
      const outcome = await run();
      await query(
        client,
        'update idempotency_records set status = $2, response = $3::jsonb, completed = true where key = $1',
        [key, outcome.status, JSON.stringify(outcome.body)],
      );
      return outcome;
    } catch (error) {
      if (error instanceof ApiError && STORED_ERROR_STATUSES.has(error.status)) {
        await query(
          client,
          'update idempotency_records set status = $2, response = $3::jsonb, completed = true where key = $1',
          [key, error.status, JSON.stringify(error.body())],
        );
      }
      throw error;
    }
  } finally {
    if (lock !== undefined) {
      await client
        .query('select pg_advisory_unlock(hashtextextended($1, 0))', [lock])
        .catch(() => undefined);
    }
    await client
      .query('select pg_advisory_unlock(hashtextextended($1, 0))', [key])
      .catch(() => undefined);
    client.release();
  }
}
