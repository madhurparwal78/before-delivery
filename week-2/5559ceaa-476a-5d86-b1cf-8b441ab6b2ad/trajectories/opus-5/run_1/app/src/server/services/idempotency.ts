import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { idempotencyConflict, validation } from '../http/errors.js';

export interface Outcome {
  status: number;
  payload: unknown;
}

const IN_FLIGHT = 0;
const WAIT_STEP_MS = 50;
const WAIT_STEPS = 60;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requireIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header.length < 1 || header.length > 100) {
    throw validation({ 'Idempotency-Key': 'Send an Idempotency-Key header of 1 to 100 characters.' });
  }
  return header;
}

interface RecordRow {
  body_hash: string;
  status: number;
  response: unknown;
}

async function read(userId: string, key: string): Promise<RecordRow | undefined> {
  const { rows } = await pool.query<RecordRow>(
    'select body_hash, status, response from idempotency_records where user_id = $1 and key = $2',
    [userId, key],
  );
  return rows[0];
}

/**
 * Runs an operation at most once per key for one account, replaying the stored
 * status and body for a repeat and refusing a different body under the same key.
 */
export async function withIdempotency(
  userId: string,
  key: string,
  body: unknown,
  run: () => Promise<Outcome>,
): Promise<Outcome> {
  const hash = createHash('sha256').update(canonical(body), 'utf8').digest('hex');
  const reserved = await pool.query(
    `insert into idempotency_records (user_id, key, body_hash, status, response)
     values ($1, $2, $3, $4, 'null'::jsonb)
     on conflict (user_id, key) do nothing`,
    [userId, key, hash, IN_FLIGHT],
  );

  if (reserved.rowCount === 0) {
    let stored = await read(userId, key);
    for (let step = 0; step < WAIT_STEPS && stored?.status === IN_FLIGHT; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
      stored = await read(userId, key);
    }
    if (stored === undefined) throw idempotencyConflict();
    if (stored.body_hash !== hash) throw idempotencyConflict();
    return { status: stored.status, payload: stored.response };
  }

  try {
    const outcome = await run();
    await pool.query(
      'update idempotency_records set status = $3, response = $4 where user_id = $1 and key = $2',
      [userId, key, outcome.status, JSON.stringify(outcome.payload)],
    );
    return outcome;
  } catch (cause) {
    await pool.query('delete from idempotency_records where user_id = $1 and key = $2', [
      userId,
      key,
    ]);
    throw cause;
  }
}
