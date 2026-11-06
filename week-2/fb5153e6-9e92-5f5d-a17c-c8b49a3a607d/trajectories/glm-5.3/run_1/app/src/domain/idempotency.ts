import { createHash } from 'node:crypto';
import { withTransaction, one } from '../db/db.js';
import { ApiError } from '../errors.js';

const mutexes = new Map<string, Promise<unknown>>();

/** Serialises work under one idempotency key so a second request waits for the first. */
export async function withIdempotencyKey<T>(scope: string, key: string, fn: () => Promise<T>): Promise<T> {
  const mapKey = `${scope}:${key}`;
  const existing = mutexes.get(mapKey);
  if (existing !== undefined) {
    await existing.catch(() => undefined);
  }
  const run = fn();
  mutexes.set(mapKey, run);
  try {
    return await run;
  } finally {
    if (mutexes.get(mapKey) === run) mutexes.delete(mapKey);
  }
}

export function bodyHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface StoredResponse {
  status: number;
  body: string;
  content_type: string;
}

/**
 * The single idempotent replay rule: the first request with a key decides the outcome,
 * is stored below 500, replayed byte for byte for the same body, 409 for a different body.
 */
export async function idempotent(
  endpoint: string,
  key: string,
  rawBody: string,
  fn: () => Promise<{ status: number; body: string; contentType: string }>,
): Promise<StoredResponse> {
  const hash = bodyHash(rawBody);
  return withIdempotencyKey(endpoint, key, async () => {
    const record = await one<{ body_hash: string; status: number | null; response_body: Buffer | null; content_type: string | null }>(
      'SELECT body_hash, status, response_body, content_type FROM idempotency_records WHERE endpoint = $1 AND idem_key = $2',
      [endpoint, key],
    );
    if (record !== null) {
      if (record.body_hash !== hash) throw new ApiError(409, 'idempotency_key_reused');
      if (record.status !== null && record.response_body !== null) {
        return {
          status: record.status,
          body: record.response_body.toString('utf8'),
          content_type: record.content_type ?? 'application/json',
        };
      }
    }
    if (record === null) {
      await withTransaction(async client => {
        await client.query(
          'INSERT INTO idempotency_records (endpoint, idem_key, body_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [endpoint, key, hash],
        );
      });
    }
    const result = await fn();
    if (result.status < 500) {
      await withTransaction(async client => {
        await client.query(
          `UPDATE idempotency_records SET status = $3, response_body = $4, content_type = $5
           WHERE endpoint = $1 AND idem_key = $2`,
          [endpoint, key, result.status, Buffer.from(result.body, 'utf8'), result.contentType],
        );
      });
    }
    return { status: result.status, body: result.body, content_type: result.contentType };
  });
}
