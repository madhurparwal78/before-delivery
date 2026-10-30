import { query } from '../db.js';
import { ApiError } from '../errors.js';

const MEMORY_MILLIS = 24 * 60 * 60 * 1000;
const WAIT_STEPS = 50;
const WAIT_MILLIS = 100;

export type Claim = { owned: true } | { owned: false; status: number; body: unknown };

interface KeyRow {
  same: boolean;
  status: number | null;
  response: unknown;
  created_at: Date;
}

const sleep = (millis: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, millis));

async function read(key: string, body: unknown): Promise<KeyRow | undefined> {
  const result = await query<KeyRow>(
    'select (request = $2::jsonb) as same, status, response, created_at from idempotency_keys where key = $1',
    [key, JSON.stringify(body)],
  );
  return result.rows[0];
}

/**
 * Claims an Idempotency-Key for this body, or hands back the answer the key already has.
 * The same key with a different body is refused.
 */
export async function claimKey(key: string, body: unknown, at: Date): Promise<Claim> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inserted = await query<{ key: string }>(
      `insert into idempotency_keys (key, request, created_at) values ($1, $2::jsonb, $3)
       on conflict (key) do nothing
       returning key`,
      [key, JSON.stringify(body), at],
    );
    if (inserted.rowCount === 1) return { owned: true };

    const existing = await read(key, body);
    if (!existing) continue;
    if (at.getTime() - existing.created_at.getTime() >= MEMORY_MILLIS) {
      await query('delete from idempotency_keys where key = $1 and created_at = $2', [key, existing.created_at]);
      continue;
    }
    if (!existing.same) throw new ApiError('idempotency_conflict');
    if (existing.status !== null) return { owned: false, status: existing.status, body: existing.response };

    // Another request with the same key and body is still working; wait for its answer.
    for (let step = 0; step < WAIT_STEPS; step += 1) {
      await sleep(WAIT_MILLIS);
      const settled = await read(key, body);
      if (!settled) break;
      if (settled.status !== null) return { owned: false, status: settled.status, body: settled.response };
    }
    return { owned: true };
  }
  return { owned: true };
}

export async function rememberResponse(key: string, status: number, body: unknown): Promise<void> {
  await query('update idempotency_keys set status = $2, response = $3::jsonb where key = $1', [
    key,
    status,
    JSON.stringify(body),
  ]);
}

/** Only 202 answers are remembered, so a refused save forgets its key. */
export async function forgetKey(key: string): Promise<void> {
  await query('delete from idempotency_keys where key = $1 and status is null', [key]);
}
