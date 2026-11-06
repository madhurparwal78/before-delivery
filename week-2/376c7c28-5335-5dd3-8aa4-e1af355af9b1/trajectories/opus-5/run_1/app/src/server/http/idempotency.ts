import { createHash } from 'node:crypto';
import { now } from '../clock.ts';
import { first, pool, query } from '../db/pool.ts';
import { ApiError } from './errors.ts';
import type { RouteResult } from './context.ts';

const VISIBLE_KEY = /^[\x21-\x7e]{1,100}$/;

export function requireKey(raw: string): string {
  if (raw === '' || !VISIBLE_KEY.test(raw)) throw new ApiError('idempotency_key_required');
  return raw;
}

export function bodyFingerprint(scope: string, body: Record<string, unknown>): string {
  return createHash('sha256').update(`${scope}\n${stable(body)}`).digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

interface StoredRow {
  readonly body_hash: string;
  readonly status: number | null;
  readonly response: unknown;
  readonly state: string;
}

export interface Claim {
  readonly replay: RouteResult | null;
  readonly finish: (result: RouteResult) => Promise<void>;
}

const STORABLE = (status: number): boolean =>
  status === 200 || status === 201 || (status >= 400 && status < 500);

export async function claim(studioId: string, key: string, fingerprint: string): Promise<Claim> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const inserted = await query<{ key: string }>(
      `insert into idempotency_keys (studio_id, key, body_hash, state, created_at)
       values ($1, $2, $3, 'running', $4)
       on conflict (studio_id, key) do nothing
       returning key`,
      [studioId, key, fingerprint, now()],
    );
    if (inserted.length === 1) {
      return {
        replay: null,
        finish: async (result: RouteResult) => {
          if (STORABLE(result.status)) {
            await pool.query(
              `update idempotency_keys
                  set status = $3, response = $4, state = 'done'
                where studio_id = $1 and key = $2`,
              [studioId, key, result.status, JSON.stringify(result.body ?? null)],
            );
          } else {
            await pool.query('delete from idempotency_keys where studio_id = $1 and key = $2', [
              studioId,
              key,
            ]);
          }
        },
      };
    }
    const row = await first<StoredRow>(
      pool,
      'select body_hash, status, response, state from idempotency_keys where studio_id = $1 and key = $2',
      [studioId, key],
    );
    if (!row) continue;
    if (row.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    if (row.body_hash !== fingerprint) throw new ApiError('idempotency_conflict');
    return {
      replay: { status: row.status ?? 200, body: row.response },
      finish: async () => undefined,
    };
  }
  throw new ApiError('idempotency_conflict');
}
