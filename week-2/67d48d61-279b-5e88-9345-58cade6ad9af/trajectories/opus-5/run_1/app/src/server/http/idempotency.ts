import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { ApiError, apiError } from './errors.js';
import type { Reply } from './reply.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
}

interface Stored {
  method: string;
  path: string;
  body_hash: string;
  status: number | null;
  response: unknown;
}

/**
 * A repeat with the same key, path and body returns the stored response and changes
 * nothing. Responses of 500 and above are not stored, so a retry runs again.
 */
export async function withIdempotency(
  key: string | null,
  method: string,
  path: string,
  body: unknown,
  run: () => Promise<Reply>,
): Promise<Reply> {
  if (key === null) return run();
  const hash = createHash('sha256').update(canonical(body)).digest('hex');

  const reserved = await pool.query(
    `insert into idempotency (key, method, path, body_hash)
     values ($1, $2, $3, $4) on conflict (key) do nothing returning key`,
    [key, method, path, hash],
  );

  if (reserved.rowCount === 0) {
    const stored = await waitForStored(key);
    if (stored.method !== method || stored.path !== path || stored.body_hash !== hash) {
      throw apiError.idempotencyKeyReused();
    }
    if (stored.status === null) throw apiError.idempotencyKeyReused();
    return {
      status: stored.status,
      json: stored.response,
      headers: { 'Idempotent-Replay': 'true' },
    };
  }

  try {
    const reply = await run();
    await store(key, reply.status, reply.json);
    return reply;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await store(key, error.status, error.body());
      throw error;
    }
    await pool.query('delete from idempotency where key = $1', [key]);
    throw error;
  }
}

async function store(key: string, status: number, response: unknown): Promise<void> {
  if (status >= 500) {
    await pool.query('delete from idempotency where key = $1', [key]);
    return;
  }
  await pool.query('update idempotency set status = $2, response = $3 where key = $1', [
    key,
    status,
    JSON.stringify(response ?? null),
  ]);
}

async function waitForStored(key: string): Promise<Stored> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<Stored>(
      'select method, path, body_hash, status, response from idempotency where key = $1',
      [key],
    );
    const row = result.rows[0];
    if (row && row.status !== null) return row;
    if (row && attempt === 99) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw apiError.idempotencyKeyReused();
}
