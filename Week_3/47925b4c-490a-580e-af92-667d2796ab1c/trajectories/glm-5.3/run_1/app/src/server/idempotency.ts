// Idempotency scoped by method, path and key: one effect, one stored outcome under
// replay, parallel duplicates and retries across processes (DP-22).

import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';

export type IdempotencyOutcome =
  | { kind: 'fresh' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'reused' }
  | { kind: 'claimed' };

const CLAIM_MS = 60_000;

export function requestHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// Tries to claim the key. A fresh claim lets the action run; a replay of the same body
// returns the stored response; a different body is a reuse; a key claimed by a live
// process waits briefly; a key held by a stopped process is free again after 60 seconds.
export async function beginIdempotent(
  client: PoolClient,
  key: string,
  scope: string,
  hash: string,
): Promise<IdempotencyOutcome> {
  // Insert first so parallel duplicates race on the unique key; the loser re-reads.
  try {
    const claimedUntil = new Date(Date.now() + CLAIM_MS);
    await client.query(
      'INSERT INTO idempotency (key, scope, request_hash, claimed_until) VALUES ($1,$2,$3,$4)',
      [key, scope, hash, claimedUntil],
    );
    return { kind: 'fresh' };
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
  }
  const existing = await client.query<{ request_hash: string; status: number | null; body: unknown; claimed_until: Date | null }>(
    'SELECT request_hash, status, body, claimed_until FROM idempotency WHERE key = $1 AND scope = $2 FOR UPDATE',
    [key, scope],
  );
  const row = existing.rows[0];
  if (row === undefined) return { kind: 'reused' }; // a concurrent delete; refuse safely
  if (row.status === null) {
    const expiry = row.claimed_until === null ? 0 : new Date(row.claimed_until).getTime();
    if (expiry > Date.now()) return { kind: 'claimed' };
    await client.query(
      'UPDATE idempotency SET request_hash = $3, claimed_until = $4 WHERE key = $1 AND scope = $2',
      [key, scope, hash, new Date(Date.now() + CLAIM_MS)],
    );
    return { kind: 'fresh' };
  }
  if (row.request_hash !== hash) return { kind: 'reused' };
  return { kind: 'replay', status: row.status, body: row.body };
}

// A 5xx outcome is not stored, so the same key retries the action.
export async function finishIdempotent(
  client: PoolClient,
  key: string,
  scope: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status >= 500) {
    await client.query('DELETE FROM idempotency WHERE key = $1 AND scope = $2', [key, scope]);
    return;
  }
  await client.query(
    'UPDATE idempotency SET status = $3, body = $4, claimed_until = NULL WHERE key = $1 AND scope = $2',
    [key, scope, status, JSON.stringify(body)],
  );
}
