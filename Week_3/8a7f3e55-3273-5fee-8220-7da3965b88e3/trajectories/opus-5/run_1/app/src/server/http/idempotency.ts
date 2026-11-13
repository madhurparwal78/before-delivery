import { createHash } from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { ApiError, FIELD_MESSAGES, validationError } from './errors.js';
import type { JsonResult } from './router.js';

const VALID_KEY = /^[\x21-\x7e]{1,100}$/;

interface KeyRow {
  state: string;
  method: string;
  path: string;
  body_sha: string;
  status: number | null;
  response_body: string | null;
}

export function validateKey(raw: string): void {
  if (!VALID_KEY.test(raw)) {
    throw validationError({ idempotency_key: FIELD_MESSAGES.idempotency_key });
  }
}

export interface IdempotentOutcome {
  status: number;
  body: unknown;
}

/**
 * One place claims an idempotency key: the claim is written before the action runs, so a
 * single request owns the key and every other request with it replays, waits or is refused.
 */
export async function runWithIdempotency(
  userId: string,
  key: string,
  method: string,
  path: string,
  rawBody: Buffer,
  action: () => Promise<JsonResult>,
): Promise<JsonResult> {
  const bodySha = createHash('sha256').update(rawBody).digest('hex');
  const claimed = await query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, body_sha, state)
     VALUES ($1, $2, $3, $4, $5, 'in_progress')
     ON CONFLICT (user_id, key) DO NOTHING
     RETURNING key`,
    [userId, key, method, path, bodySha],
  );

  if (claimed.length === 0) {
    const existing = await queryOne<KeyRow>(
      'SELECT state, method, path, body_sha, status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    if (!existing || existing.state === 'in_progress') {
      throw new ApiError('idempotency_in_progress');
    }
    if (existing.method === method && existing.path === path && existing.body_sha === bodySha) {
      return {
        status: existing.status ?? 200,
        body: existing.response_body === null ? undefined : JSON.parse(existing.response_body),
      };
    }
    throw new ApiError('idempotency_key_reused');
  }

  let result: JsonResult;
  try {
    result = await action();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status !== 503) {
      await query(
        `UPDATE idempotency_keys SET state = 'done', status = $3, response_body = $4
         WHERE user_id = $1 AND key = $2`,
        [userId, key, cause.status, JSON.stringify(cause.body())],
      );
    } else {
      await query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
    }
    throw cause;
  }

  await query(
    `UPDATE idempotency_keys SET state = 'done', status = $3, response_body = $4
     WHERE user_id = $1 AND key = $2`,
    [userId, key, result.status, result.body === undefined ? null : JSON.stringify(result.body)],
  );
  return result;
}

export async function purgeExpiredKeys(): Promise<void> {
  await query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'");
}
