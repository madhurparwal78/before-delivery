import { createHash } from 'node:crypto';
import { pool, query, queryOne, withTransaction } from '../db';
import { idempotencyConflict, idempotencyInProgress } from './errors';

export type KeyClaim = { kind: 'owned' } | { kind: 'replay'; status: number; body: string };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function bodyFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Step 5 of the precedence: replay, conflict, in progress, or this process owns the run. */
export async function claimKey(
  userId: string,
  endpoint: string,
  key: string,
  fingerprint: string,
): Promise<KeyClaim> {
  return withTransaction(async (client) => {
    const inserted = await queryOne<{ key: string }>(
      client,
      `insert into idempotency_keys (user_id, endpoint, key, body_fingerprint, state)
       values ($1,$2,$3,$4,'running')
       on conflict (user_id, endpoint, key) do nothing
       returning key`,
      [userId, endpoint, key, fingerprint],
    );
    if (inserted !== null) return { kind: 'owned' };

    const existing = await queryOne<{
      body_fingerprint: string;
      state: 'running' | 'done';
      response_status: number | null;
      response_body: string | null;
    }>(
      client,
      `select body_fingerprint, state, response_status, response_body from idempotency_keys
       where user_id = $1 and endpoint = $2 and key = $3`,
      [userId, endpoint, key],
    );
    if (existing === null) return { kind: 'owned' };
    if (existing.body_fingerprint !== fingerprint) throw idempotencyConflict();
    if (existing.state === 'running' || existing.response_body === null || existing.response_status === null) {
      throw idempotencyInProgress();
    }
    return { kind: 'replay', status: existing.response_status, body: existing.response_body };
  });
}

export async function storeKeyResponse(
  userId: string,
  endpoint: string,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await pool.query(
    `update idempotency_keys set state = 'done', response_status = $4, response_body = $5
     where user_id = $1 and endpoint = $2 and key = $3`,
    [userId, endpoint, key, status, body],
  );
}

/** After any error the key runs fresh. */
export async function releaseKey(userId: string, endpoint: string, key: string): Promise<void> {
  const client = await pool.connect();
  try {
    await query(
      client,
      `delete from idempotency_keys where user_id = $1 and endpoint = $2 and key = $3 and state = 'running'`,
      [userId, endpoint, key],
    );
  } finally {
    client.release();
  }
}

export function isValidKey(key: string): boolean {
  return key.length >= 1 && key.length <= 100 && /^[\x21-\x7E]+$/.test(key);
}
