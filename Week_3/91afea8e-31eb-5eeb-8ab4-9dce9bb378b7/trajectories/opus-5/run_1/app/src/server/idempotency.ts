/** One order per Idempotency-Key: stored replies, waiting replays and reuse conflicts. */

import { config } from './config.js';
import { one, query } from './db.js';
import { hashBody } from './domain/identity.js';
import { ApiError } from './http/errors.js';
import type { Reply } from './http/router.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function readIdempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !KEY_PATTERN.test(value)) {
    throw new ApiError(428, 'idempotency_key_required');
  }
  return value;
}

type StoredRecord = { state: string; status: number | null; response: unknown; body_hash: string };

async function readRecord(accountId: string, key: string): Promise<StoredRecord | null> {
  return one<StoredRecord>(
    `SELECT state, status, response, body_hash FROM idempotency_records
      WHERE account_id = $1 AND key = $2`,
    [accountId, key],
  );
}

export async function withIdempotency(
  accountId: string,
  key: string,
  body: unknown,
  run: () => Promise<Reply>,
): Promise<{ reply: Reply; replayed: boolean }> {
  const bodyHash = hashBody(body);
  await query(
    `DELETE FROM idempotency_records WHERE account_id = $1 AND key = $2 AND expires_at <= now()`,
    [accountId, key],
  );
  const claimed = await query<{ key: string }>(
    `INSERT INTO idempotency_records (account_id, key, body_hash, state, expires_at)
     VALUES ($1, $2, $3, 'running', now() + ($4 || ' seconds')::interval)
     ON CONFLICT (account_id, key) DO NOTHING
     RETURNING key`,
    [accountId, key, bodyHash, String(config.idempotencyTtlSeconds)],
  );

  if (claimed.length === 0) {
    const existing = await readRecord(accountId, key);
    if (existing === null) return withIdempotency(accountId, key, body, run);
    if (existing.body_hash !== bodyHash) throw new ApiError(409, 'idempotency_key_reused');
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const record = await readRecord(accountId, key);
      if (record !== null && record.state === 'done' && record.status !== null) {
        return {
          reply: { kind: 'json', status: record.status, body: record.response },
          replayed: true,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ApiError(409, 'idempotency_key_reused');
  }

  try {
    const reply = await run();
    if (reply.kind === 'json') {
      await query(
        `UPDATE idempotency_records SET state = 'done', status = $3, response = $4::jsonb
          WHERE account_id = $1 AND key = $2`,
        [accountId, key, reply.status, JSON.stringify(reply.body)],
      );
    }
    return { reply, replayed: false };
  } catch (error) {
    if (error instanceof ApiError) {
      await query(
        `UPDATE idempotency_records SET state = 'done', status = $3, response = $4::jsonb
          WHERE account_id = $1 AND key = $2`,
        [accountId, key, error.status, JSON.stringify(error.body())],
      );
    } else {
      await query(`DELETE FROM idempotency_records WHERE account_id = $1 AND key = $2`, [
        accountId,
        key,
      ]);
    }
    throw error;
  }
}
