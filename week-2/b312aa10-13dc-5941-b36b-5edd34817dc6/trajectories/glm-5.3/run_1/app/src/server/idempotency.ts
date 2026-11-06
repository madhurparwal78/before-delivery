import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function requireIdempotencyKey(header: string | undefined): string {
  if (!header || !KEY_RE.test(header)) {
    throw new ApiError('idempotency_key_required');
  }
  return header;
}

/** Two requests are the same when they have the same path and equal parsed JSON bodies (key order and whitespace ignored). */
export function bodyFingerprint(body: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, stable(v)]);
      return entries;
    }
    return value;
  };
  return JSON.stringify(stable(body));
}

export interface StoredIdempotentResponse {
  status: number;
  body: string;
}

/**
 * Returns the stored response for a replay, null when the request is new, and
 * throws idempotency_key_reused when the key was used for a different request.
 * A repeat that arrives while the first is running waits for it: the row is
 * inserted with a held status first, and concurrent inserts block on it.
 */
export async function checkIdempotency(
  client: PoolClient,
  personId: string,
  key: string,
  method: string,
  path: string,
  fingerprint: string,
): Promise<StoredIdempotentResponse | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [personId, key]);
  const existing = await client.query<{ status: number; response_body: string; body_fingerprint: string }>(
    `SELECT status, response_body, body_fingerprint FROM idempotency WHERE person_id=$1 AND key=$2`,
    [personId, key],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.body_fingerprint !== fingerprint) {
      throw new ApiError('idempotency_key_reused');
    }
    return { status: row.status, body: row.response_body };
  }
  await client.query(
    `INSERT INTO idempotency (person_id, key, method, path, body_fingerprint, status, response_body)
     VALUES ($1,$2,$3,$4,$5,-1,'')`,
    [personId, key, method, path, fingerprint],
  );
  return null;
}

export async function storeIdempotentResponse(
  client: PoolClient,
  personId: string,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await client.query(`UPDATE idempotency SET status=$3, response_body=$4 WHERE person_id=$1 AND key=$2`, [
    personId,
    key,
    status,
    body,
  ]);
}
