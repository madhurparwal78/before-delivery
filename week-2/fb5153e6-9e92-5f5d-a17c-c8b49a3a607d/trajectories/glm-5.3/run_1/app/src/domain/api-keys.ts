import { createHash } from 'node:crypto';
import { one, query } from '../db/db.js';
import { ApiError } from '../errors.js';
import { planOf } from './plans.js';
import { planState } from './plan-service.js';

export interface ApiKeyRow {
  id: number;
  ref: string;
  name: string;
  key_hash: string;
  created_at: string;
  active: boolean;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function findActiveKey(ref: string): Promise<ApiKeyRow | null> {
  const row = await one<ApiKeyRow>('SELECT id, ref, name, key_hash, created_at, active FROM api_keys WHERE ref = $1', [ref]);
  if (row === null || !row.active) return null;
  return row;
}

export async function activeKeysRanked(): Promise<ApiKeyRow[]> {
  const rows = await query<ApiKeyRow>(
    'SELECT id, ref, name, key_hash, created_at, active FROM api_keys WHERE active = true ORDER BY created_at ASC, id ASC',
  );
  return rows.rows;
}

export async function checkKeyInPlan(key: ApiKeyRow): Promise<void> {
  const state = await planState();
  const plan = planOf(state.plan);
  const keys = await activeKeysRanked();
  const rank = keys.findIndex(candidate => candidate.id === key.id);
  if (rank >= plan.apiKeys) throw new ApiError(403, 'not_in_plan');
}

/** Rolling 60 requests per 60 seconds per key. */
export async function checkRateLimit(key: ApiKeyRow): Promise<{ remaining: number; retryAfter: number | null }> {
  const now = Math.floor(Date.now() / 1000);
  const client = await (await import('../db/db.js')).pool.connect();
  try {
    await client.query('BEGIN');
    const start = now - 59;
    const rows = await client.query<{ bucket_second: string; count: string }>(
      'SELECT bucket_second::text AS bucket_second, count FROM rate_limits WHERE key_id = $1 AND bucket_second > $2',
      [key.id, start],
    );
    let total = 0;
    for (const row of rows.rows) {
      total += Number(row.count);
    }
    if (total >= 60) {
      await client.query('COMMIT');
      // The window covers the last 60 seconds; retry when enough old buckets have aged out.
      let running = total;
      let allowedAt = now + 60;
      for (const row of rows.rows) {
        if (running < 60) break;
        running -= Number(row.count);
        allowedAt = Number(row.bucket_second) + 60;
      }
      return { remaining: 0, retryAfter: Math.max(1, Math.min(60, allowedAt - now)) };
    }
    await client.query(
      `INSERT INTO rate_limits (key_id, bucket_second, count) VALUES ($1, $2, 1)
       ON CONFLICT (key_id, bucket_second) DO UPDATE SET count = rate_limits.count + 1`,
      [key.id, now],
    );
    await client.query('DELETE FROM rate_limits WHERE key_id = $1 AND bucket_second <= $2', [key.id, now - 60]);
    await client.query('COMMIT');
    return { remaining: Math.max(0, 59 - total), retryAfter: null };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function rateLimitedError(retryAfter: number): ApiError {
  const error = new ApiError(429, 'rate_limited', { seconds: retryAfter });
  return Object.assign(error, { extraHeaders: { 'Retry-After': String(retryAfter) } });
}
