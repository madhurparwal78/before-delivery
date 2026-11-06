import type { Request } from 'express';
import { one, query } from '../db/pool.js';
import { fail } from '../errors.js';
import { sha256Hex } from '../util.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function idempotencyKey(req: Request): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !KEY_PATTERN.test(value)) {
    throw fail('validation', {
      fields: { idempotency_key: 'Send an Idempotency-Key of 1 to 64 letters, digits, - or _.' },
    });
  }
  return value;
}

interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

interface Row {
  body_hash: string;
  status: number;
  response: unknown;
}

/**
 * The stored response for this user, endpoint and key, or null when the key is
 * new. The same key with a different body is refused.
 */
export async function replayed(
  userId: string,
  endpoint: string,
  key: string,
  body: unknown,
): Promise<StoredResponse | null> {
  const hash = sha256Hex(JSON.stringify(body ?? {}));
  const row = await one<Row>(
    'SELECT body_hash, status, response FROM idempotency WHERE user_id = $1 AND endpoint = $2 AND key = $3',
    [userId, endpoint, key],
  );
  if (row === null) return null;
  if (row.body_hash !== hash) throw fail('idempotency_key_reused');
  return { status: row.status, body: row.response };
}

/** Responses with status 500 or more are never stored, so a retry runs again. */
export async function remember(
  userId: string,
  endpoint: string,
  key: string,
  body: unknown,
  status: number,
  response: unknown,
): Promise<void> {
  if (status >= 500) return;
  await query(
    `INSERT INTO idempotency (user_id, endpoint, key, body_hash, status, response)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING`,
    [userId, endpoint, key, sha256Hex(JSON.stringify(body ?? {})), status, JSON.stringify(response)],
  );
}
