import { createHash } from 'node:crypto';
import type pg from 'pg';
import { one } from './db.js';
import { now } from './clock.js';
import { validation } from './errors.js';
import { COPY } from './validate.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface Stored { status: number; body: unknown }
export interface Outcome extends Stored { replayed: boolean }

/**
 * Runs `work` once per (member, endpoint, key) inside the caller's transaction. The key row is inserted first,
 * so concurrent duplicates wait for the winner and then replay its stored response.
 */
export async function once(
  client: pg.PoolClient, memberId: string, endpoint: string, key: string, request: unknown, work: () => Promise<Stored>,
): Promise<Outcome> {
  const fingerprint = createHash('sha256').update(`${endpoint}\n${canonicalJson(request)}`).digest('hex');
  const inserted = await one(client,
    `INSERT INTO idempotency_keys (member_id, endpoint, key, fingerprint, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING 1 AS inserted`,
    [memberId, endpoint, key, fingerprint, now()]);
  if (!inserted) {
    const stored = await one<{ fingerprint: string; status: number; response: unknown }>(client,
      'SELECT fingerprint, status, response FROM idempotency_keys WHERE member_id = $1 AND endpoint = $2 AND key = $3',
      [memberId, endpoint, key]);
    if (stored?.fingerprint !== fingerprint) throw validation({ idempotencyKey: COPY.idempotencyReused });
    return { status: stored.status, body: stored.response, replayed: true };
  }
  const result = await work();
  await client.query(
    'UPDATE idempotency_keys SET status = $4, response = $5 WHERE member_id = $1 AND endpoint = $2 AND key = $3',
    [memberId, endpoint, key, result.status, JSON.stringify(result.body)]);
  return { ...result, replayed: false };
}
