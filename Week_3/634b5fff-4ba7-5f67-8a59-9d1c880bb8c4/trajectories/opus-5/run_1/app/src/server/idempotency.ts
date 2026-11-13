import { createHash } from 'node:crypto';
import { one, query } from './db.js';
import { fail } from './errors.js';

export type IdempotencyScope = 'checkout' | 'refund';

interface KeyRow {
  request_hash: string;
  status: number | null;
  body: unknown;
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export type Claim = { kind: 'fresh' } | { kind: 'replay'; status: number; body: unknown };

/**
 * One key yields one effect: a repeat with the same body waits for and returns
 * the first result, and a different body is refused.
 */
export async function claimKey(
  scope: IdempotencyScope,
  key: string,
  requestHash: string,
): Promise<Claim> {
  const inserted = await query(
    `INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT (scope, key) DO NOTHING RETURNING key`,
    [scope, key, requestHash],
  );
  if (inserted.length > 0) return { kind: 'fresh' };

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = await one<KeyRow>(
      'SELECT request_hash, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2',
      [scope, key],
    );
    if (row === null) return { kind: 'fresh' };
    if (row.request_hash !== requestHash) throw fail(409, 'idempotency_conflict');
    if (row.status !== null) return { kind: 'replay', status: row.status, body: row.body };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw fail(409, 'idempotency_conflict');
}

export async function storeResult(
  scope: IdempotencyScope,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    'UPDATE idempotency_keys SET status = $3, body = $4 WHERE scope = $1 AND key = $2',
    [scope, key, status, JSON.stringify(body)],
  );
}

export async function releaseKey(scope: IdempotencyScope, key: string): Promise<void> {
  await query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status IS NULL', [
    scope,
    key,
  ]);
}
