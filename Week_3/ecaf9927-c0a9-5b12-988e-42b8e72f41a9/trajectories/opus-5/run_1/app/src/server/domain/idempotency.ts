import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { errors } from '../errors.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export type IdempotentOutcome = { status: number; response: unknown; replayed: boolean };

/**
 * The one idempotency gate: the same key and body replays the first answer, a different
 * body conflicts, and simultaneous duplicates both wait on one record.
 */
export async function withIdempotency(
  memberId: string,
  path: string,
  key: string,
  requestBody: unknown,
  run: () => Promise<{ status: number; response: unknown }>,
): Promise<IdempotentOutcome> {
  const requestHash = createHash('sha256').update(canonical(requestBody)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1), hashtext($2))', [
      `${memberId}|${path}`,
      key,
    ]);
    const { rows } = await client.query<{ request_hash: string; status: number; response: unknown }>(
      'select request_hash, status, response from idempotency_records where member_id = $1 and path = $2 and key = $3',
      [memberId, path, key],
    );
    const found = rows[0];
    if (found) {
      if (found.request_hash !== requestHash) throw errors.idempotencyConflict();
      return { status: found.status, response: found.response, replayed: true };
    }
    const outcome = await run();
    await client.query(
      `insert into idempotency_records (member_id, path, key, request_hash, status, response)
       values ($1, $2, $3, $4, $5, $6)`,
      [memberId, path, key, requestHash, outcome.status, JSON.stringify(outcome.response)],
    );
    return { ...outcome, replayed: false };
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1), hashtext($2))', [
      `${memberId}|${path}`,
      key,
    ]);
    client.release();
  }
}
