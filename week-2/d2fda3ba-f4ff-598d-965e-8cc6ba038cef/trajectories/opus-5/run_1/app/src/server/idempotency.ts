import { createHash } from 'node:crypto';
import type { Database } from './db';
import { ApiError } from './errors';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function bodyFingerprint(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * The stored answer for a repeated request, or null for a fresh key.
 * The same key with a different body is refused.
 */
export async function replayedResponse(
  db: Database,
  deviceId: string,
  endpoint: string,
  key: string,
  fingerprint: string,
): Promise<StoredResponse | null> {
  const row = await db.one<{ body_sha256: string; status: number; response: unknown }>(
    'select body_sha256, status, response from idempotency_keys where device_id = $1 and endpoint = $2 and key = $3',
    [deviceId, endpoint, key],
  );
  if (!row) return null;
  if (row.body_sha256 !== fingerprint) {
    throw new ApiError(409, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different body.');
  }
  return { status: row.status, body: row.response };
}

/** Only 2xx and 4xx answers are kept, so a 503 leaves the key free for a retry. */
export async function rememberResponse(
  db: Database,
  deviceId: string,
  endpoint: string,
  key: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status >= 500) return;
  await db.query(
    `insert into idempotency_keys (device_id, endpoint, key, body_sha256, status, response)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (device_id, endpoint, key) do nothing`,
    [deviceId, endpoint, key, fingerprint, status, JSON.stringify(body)],
  );
}

export async function forgetExpiredKeys(db: Database, ttlSeconds: number): Promise<void> {
  await db.query("delete from idempotency_keys where created_at < now() - ($1 || ' seconds')::interval", [
    String(ttlSeconds),
  ]);
}
