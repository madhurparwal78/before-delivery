import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { ApiError, unprocessable } from '../http/errors.js';
import { Response } from '../http/server.js';

const POLL_INTERVAL_MS = 100;
const POLL_LIMIT = 50;

interface StoredRecord {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export function requestHash(path: string, rawBody: Buffer): string {
  return createHash('sha256').update(path).update('\u0000').update(rawBody).digest('hex');
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Idempotency keys are scoped to the member. The same key with the same body replays the
 * stored response; a different body is a mismatch. Concurrent requests with one key
 * produce one effect and all receive the same response.
 */
export async function withIdempotency(
  memberId: string,
  key: string,
  hash: string,
  action: () => Promise<Response>,
): Promise<Response> {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    const claimed = await pool.query(
      `insert into idempotency_records (member_id, key, request_hash, created_at, expires_at)
       values ($1, $2, $3, now(), now() + ($4 || ' seconds')::interval)
       on conflict (member_id, key) do nothing`,
      [memberId, key, hash, String(config.idempotencyTtlSeconds)],
    );

    if (claimed.rowCount === 1) {
      try {
        const response = await action();
        await pool.query(
          `update idempotency_records set response_status = $3, response_body = $4::jsonb
            where member_id = $1 and key = $2`,
          [memberId, key, response.status, JSON.stringify(response.body ?? null)],
        );
        return response;
      } catch (error) {
        await pool.query('delete from idempotency_records where member_id = $1 and key = $2', [
          memberId,
          key,
        ]);
        throw error;
      }
    }

    const existing = await pool.query<StoredRecord>(
      'select request_hash, response_status, response_body from idempotency_records where member_id = $1 and key = $2',
      [memberId, key],
    );
    const record = existing.rows[0];
    if (!record) continue;
    if (record.request_hash !== hash) {
      throw unprocessable('idempotency_key_mismatch', 'That idempotency key was used with a different body.');
    }
    if (record.response_status !== null) {
      return new Response(record.response_status, record.response_body, {
        'Idempotent-Replayed': 'true',
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ApiError(409, 'idempotency_in_flight', 'That idempotency key is still in flight.');
}

export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || key.length < 1 || key.length > 200) {
    throw new ApiError(400, 'idempotency_key_required', 'Send an Idempotency-Key header.');
  }
  return key;
}
