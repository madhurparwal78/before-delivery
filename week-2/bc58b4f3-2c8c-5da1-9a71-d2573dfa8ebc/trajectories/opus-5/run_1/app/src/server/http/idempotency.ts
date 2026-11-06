import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import { fail } from './errors.js';

const PRINTABLE_ASCII = /^[\x20-\x7e]{1,100}$/;

export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || !PRINTABLE_ASCII.test(key)) {
    fail('idempotency_key_required');
  }
  return key;
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return entries.map(([key, inner]) => [key, canonicalise(inner)]);
  }
  return value;
}

export function bodyFingerprint(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(body))).digest('hex');
}

export interface IdempotencyClaim {
  id: number;
  owned: boolean;
  storedStatus: number | null;
  storedBody: unknown;
}

/**
 * Registers the key for this scheduler. The insert blocks on a concurrent request holding the
 * same key, so only the first caller owns it and the rest read its stored answer.
 */
export async function claimIdempotencyKey(
  tx: Queryable,
  userId: number,
  key: string,
  fingerprint: string,
): Promise<IdempotencyClaim> {
  const result = await tx.query<{
    id: number;
    body_hash: string;
    response_status: number | null;
    response_body: unknown;
    inserted: boolean;
  }>(
    `INSERT INTO idempotency_records (user_id, idempotency_key, body_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, idempotency_key)
     DO UPDATE SET body_hash = idempotency_records.body_hash
     RETURNING id, body_hash, response_status, response_body, (xmax = 0) AS inserted`,
    [userId, key, fingerprint],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('idempotency record upsert returned nothing');
  }
  if (!row.inserted && row.body_hash !== fingerprint) {
    fail('idempotency_conflict');
  }
  return { id: row.id, owned: row.inserted, storedStatus: row.response_status, storedBody: row.response_body };
}

export async function storeIdempotentResponse(
  tx: Queryable,
  id: number,
  status: number,
  body: unknown,
): Promise<void> {
  await tx.query('UPDATE idempotency_records SET response_status = $1, response_body = $2 WHERE id = $3', [
    status,
    JSON.stringify(body),
    id,
  ]);
}
