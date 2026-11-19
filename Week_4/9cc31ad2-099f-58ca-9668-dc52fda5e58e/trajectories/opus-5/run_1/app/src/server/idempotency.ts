import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Queryable } from './db.js';
import { one } from './db.js';
import { ApiError, conflict } from './errors.js';

export interface StoredAnswer {
  status: number;
  body: unknown;
}

export function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key'];
  const value = Array.isArray(key) ? key[0] : key;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header.');
  }
  return value;
}

/**
 * Runs `work` once per idempotency key. A byte-identical repeat returns the stored
 * answer and writes nothing; the same key with a different body is refused.
 */
export async function withIdempotency(
  tx: Queryable,
  playerId: string,
  key: string,
  bodyBytes: Buffer,
  work: () => Promise<StoredAnswer>,
): Promise<StoredAnswer> {
  const bodyHash = createHash('sha256').update(bodyBytes).digest('hex');
  const claimed = await one<{ key: string }>(
    tx,
    `insert into idempotency_records (player_id, key, body_hash)
     values ($1, $2, $3)
     on conflict (player_id, key) do nothing
     returning key`,
    [playerId, key, bodyHash],
  );
  if (!claimed) {
    const stored = await one<{ body_hash: string; status: number; response: unknown }>(
      tx,
      'select body_hash, status, response from idempotency_records where player_id = $1 and key = $2',
      [playerId, key],
    );
    if (!stored || stored.body_hash !== bodyHash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used with another body.');
    }
    return { status: stored.status, body: stored.response };
  }

  let answer: StoredAnswer;
  try {
    answer = await work();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    answer = { status: error.status, body: error.body() };
  }
  await tx.query(
    'update idempotency_records set status = $3, response = $4 where player_id = $1 and key = $2',
    [playerId, key, answer.status, JSON.stringify(answer.body)],
  );
  return answer;
}
