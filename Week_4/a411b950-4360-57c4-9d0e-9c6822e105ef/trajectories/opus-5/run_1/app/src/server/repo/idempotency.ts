import { query } from '../db/pool.ts';

export type IdempotencyNamespace = 'brief' | 'deposit';

export type IdempotencyLookup =
  | { kind: 'fresh' }
  | { kind: 'in_progress' }
  | { kind: 'conflict' }
  | { kind: 'stored'; status: number; body: unknown };

const KEY_PATTERN = /^[\x21-\x7E]{1,100}$/;

export function isValidIdempotencyKey(value: string | undefined): value is string {
  return value !== undefined && KEY_PATTERN.test(value);
}

export async function beginIdempotentRequest(
  namespace: IdempotencyNamespace,
  key: string,
  fingerprint: string,
): Promise<IdempotencyLookup> {
  const inserted = await query<{ key: string }>(
    `INSERT INTO idempotency_records (namespace, key, fingerprint, state)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT (namespace, key) DO UPDATE
        SET fingerprint = EXCLUDED.fingerprint, created_at = now()
      WHERE idempotency_records.state = 'in_progress'
        AND idempotency_records.created_at < now() - interval '60 seconds'
     RETURNING key`,
    [namespace, key, fingerprint],
  );
  if (inserted.rows.length > 0) return { kind: 'fresh' };

  const existing = await query<{ fingerprint: string; state: string; status: number | null; body: unknown }>(
    `SELECT fingerprint, state, status, body FROM idempotency_records WHERE namespace = $1 AND key = $2`,
    [namespace, key],
  );
  const row = existing.rows[0];
  if (row === undefined) return { kind: 'fresh' };
  if (row.fingerprint !== fingerprint) return { kind: 'conflict' };
  if (row.state === 'in_progress') return { kind: 'in_progress' };
  return { kind: 'stored', status: row.status as number, body: row.body };
}

export async function storeIdempotentResponse(
  namespace: IdempotencyNamespace,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    `UPDATE idempotency_records SET state = 'done', status = $3, body = $4
      WHERE namespace = $1 AND key = $2`,
    [namespace, key, status, JSON.stringify(body)],
  );
}

export async function releaseIdempotentRequest(namespace: IdempotencyNamespace, key: string): Promise<void> {
  await query(`DELETE FROM idempotency_records WHERE namespace = $1 AND key = $2 AND state = 'in_progress'`, [
    namespace,
    key,
  ]);
}
