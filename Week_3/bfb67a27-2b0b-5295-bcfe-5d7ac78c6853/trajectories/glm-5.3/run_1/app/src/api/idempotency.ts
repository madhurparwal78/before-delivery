// Idempotency is scoped per endpoint; only sub-500 responses are stored (DP-10, DP-17).

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { idempotencyKeyReused } from './errors.js';

export interface StoredResponse {
  status: number;
  body: Buffer;
}

export async function beginIdempotent(
  client: PoolClient,
  endpoint: string,
  path: string,
  key: string | null,
  rawBody: string,
): Promise<{ kind: 'replay'; response: StoredResponse } | { kind: 'fresh'; bodyHash: string }> {
  if (key === null) {
    return { kind: 'fresh', bodyHash: hash(rawBody) };
  }
  const bodyHash = hash(rawBody);
  const existing = await client.query(
    'SELECT status, response_body, body_hash, path FROM idempotency WHERE endpoint = $1 AND key = $2 FOR UPDATE',
    [endpoint, key],
  );
  if (existing.rowCount !== null && existing.rowCount > 0) {
    const row = existing.rows[0] as { status: number; response_body: Buffer; body_hash: string; path: string };
    if (row.body_hash !== bodyHash || row.path !== path) {
      throw idempotencyKeyReused();
    }
    return {
      kind: 'replay',
      response: { status: row.status, body: Buffer.from(row.response_body) },
    };
  }
  return { kind: 'fresh', bodyHash };
}

export async function storeIdempotentResponse(
  client: PoolClient,
  endpoint: string,
  key: string | null,
  path: string,
  bodyHash: string,
  status: number,
  body: string,
): Promise<void> {
  if (key === null) {
    return;
  }
  if (status >= 500) {
    return;
  }
  await client.query(
    'INSERT INTO idempotency (key, endpoint, path, body_hash, status, response_body) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (endpoint, key) DO NOTHING',
    [key, endpoint, path, bodyHash, status, Buffer.from(body, 'utf8')],
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
