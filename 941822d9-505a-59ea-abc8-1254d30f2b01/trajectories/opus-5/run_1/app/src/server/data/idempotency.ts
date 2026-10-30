import { createHash } from 'node:crypto';
import { one, withClient } from '../db/pool.js';
import { apiError, conflict } from '../http/errors.js';
import type { Reply } from '../http/context.js';
import { newId } from '../util/ids.js';

const KEY_PATTERN = /^[\x20-\x7e]{8,128}$/;

export function readIdempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !KEY_PATTERN.test(value)) {
    throw apiError(400, 'idempotency_key_required');
  }
  return value;
}

function canonical(body: Record<string, unknown> | null): string {
  if (body === null) return 'null';
  const sorted = Object.keys(body)
    .sort()
    .map((key) => [key, body[key]] as const);
  return JSON.stringify(sorted);
}

function bodyHash(body: Record<string, unknown> | null): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

/**
 * Keys are scoped to the signed-in user. A replay with the same body returns the stored
 * response, the same key with a different body is refused, and only successes are
 * stored, so a failed request leaves its key unused. Concurrent requests with one key
 * wait for the first through an advisory lock.
 */
export async function runIdempotent(
  userId: string,
  key: string,
  body: Record<string, unknown> | null,
  run: () => Promise<Reply>,
): Promise<Reply> {
  const hash = bodyHash(body);
  const lockName = `${userId}:${key}`;
  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock(hashtext($1), 0)', [lockName]);
    try {
      const stored = await one<{ body_hash: string; status: number; response: unknown }>(
        client,
        'SELECT body_hash, status, response FROM idempotency_keys WHERE user_id = $1 AND key = $2',
        [userId, key],
      );
      if (stored !== null) {
        if (stored.body_hash !== hash) throw conflict('idempotency_key_reused');
        return { status: stored.status, json: stored.response };
      }
      const reply = await run();
      if (reply.status >= 200 && reply.status < 300) {
        await client.query(
          `INSERT INTO idempotency_keys (id, user_id, key, body_hash, status, response)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, key) DO NOTHING`,
          [newId(), userId, key, hash, reply.status, JSON.stringify(reply.json ?? null)],
        );
      }
      return reply;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1), 0)', [lockName]);
    }
  });
}
