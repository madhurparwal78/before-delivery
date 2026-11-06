import type { Transaction, DbRow } from './querier';
import { ERR } from './errors';

export interface IdempotencyRecord {
  state: 'in_progress' | 'completed';
  status: number | null;
  body: string | null;
  fingerprint: string;
}

/**
 * Idempotency keys (DP-55): scoped to caller, route and asset. A running request
 * answers 409 idempotency_in_progress; a replay returns its stored response; a
 * failure frees the key.
 */
export async function beginIdempotent(
  tx: Transaction,
  key: string | null,
  userId: string,
  route: string,
  asset: string,
  fingerprint: string
): Promise<{ record: IdempotencyRecord | null; inserted: boolean }> {
  if (key === null) return { record: null, inserted: false };
  const existing = await tx.queryOne<IdempotencyDbRow>(
    `SELECT state, status, body, fingerprint FROM idempotency WHERE key = $1 AND user_id = $2 AND route = $3 AND asset = $4`,
    [key, userId, route, asset]
  );
  if (existing) {
    if (existing.state === 'in_progress') throw ERR.idempotencyInProgress();
    if (existing.fingerprint !== fingerprint) throw ERR.idempotencyConflict();
    return {
      record: { state: 'completed', status: existing.status, body: existing.body, fingerprint: existing.fingerprint },
      inserted: false,
    };
  }
  await tx.query(
    `INSERT INTO idempotency (key, user_id, route, asset, fingerprint, state, created_at)
     VALUES ($1,$2,$3,$4,$5,'in_progress',$6)`,
    [key, userId, route, asset, fingerprint, Date.now()]
  );
  return { record: null, inserted: true };
}

export async function storeIdempotentResult(
  tx: Transaction,
  key: string,
  userId: string,
  route: string,
  asset: string,
  status: number,
  body: string
): Promise<void> {
  await tx.query(
    `UPDATE idempotency SET state = 'completed', status = $5, body = $6 WHERE key = $1 AND user_id = $2 AND route = $3 AND asset = $4`,
    [key, userId, route, asset, status, body]
  );
}

export async function releaseIdempotentKey(
  tx: Transaction,
  key: string,
  userId: string,
  route: string,
  asset: string
): Promise<void> {
  await tx.query(
    `DELETE FROM idempotency WHERE key = $1 AND user_id = $2 AND route = $3 AND asset = $4`,
    [key, userId, route, asset]
  );
}

export function validIdempotencyKey(key: string | undefined): string | null | 'invalid' {
  if (key === undefined || key === '') return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(key)) return 'invalid';
  return key;
}

interface IdempotencyDbRow extends DbRow {
  state: string;
  status: number | null;
  body: string | null;
  fingerprint: string;
}
