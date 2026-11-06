import { createHash } from 'node:crypto';
import { nowDate } from './clock.js';
import { config } from './config.js';
import { db, tx } from './db.js';
import { ApiError } from './errors.js';
import type { Reply } from './http.js';

type Stored = { body_hash: string; status: number | null; response: unknown; created_at: string };

function hashOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * A replay of a key returns the first result; the same key with a different body
 * is refused. Concurrent requests under one key run the work once.
 */
export async function withIdempotency(
  personId: string,
  endpoint: string,
  key: string | undefined,
  rawBody: Buffer,
  run: () => Promise<Reply>,
): Promise<Reply> {
  if (key === undefined) return run();
  if (key.length < 1 || key.length > 100) {
    throw new ApiError('validation', {
      fields: { idempotency_key: 'Use 1 to 100 characters.' },
      message: 'Use 1 to 100 characters.',
    });
  }
  const bodyHash = hashOf(rawBody);
  const at = nowDate().toISOString();
  const expiredBefore = new Date(nowDate().getTime() - config.idempotencyTtlSeconds * 1000).toISOString();

  const owned = await tx(async (client) => {
    await client.query(
      'delete from idempotency where person_id = $1 and endpoint = $2 and key = $3 and created_at < $4',
      [personId, endpoint, key, expiredBefore],
    );
    const inserted = await client.one<{ key: string }>(
      `insert into idempotency (person_id, endpoint, key, body_hash, created_at)
       values ($1, $2, $3, $4, $5) on conflict do nothing returning key`,
      [personId, endpoint, key, bodyHash, at],
    );
    return inserted !== undefined;
  });

  if (!owned) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const stored = await db.one<Stored>(
        'select body_hash, status, response, created_at from idempotency where person_id = $1 and endpoint = $2 and key = $3',
        [personId, endpoint, key],
      );
      if (stored === undefined) break;
      if (stored.body_hash !== bodyHash) throw new ApiError('idempotency_conflict');
      if (stored.status !== null) {
        return {
          status: stored.status,
          body: stored.response,
          headers: { 'Idempotent-Replay': 'true' },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new ApiError('idempotency_conflict');
  }

  try {
    const reply = await run();
    await db.query(
      'update idempotency set status = $4, response = $5::jsonb where person_id = $1 and endpoint = $2 and key = $3',
      [personId, endpoint, key, reply.status, JSON.stringify(reply.body ?? null)],
    );
    return reply;
  } catch (error) {
    const transient = error instanceof ApiError && error.status === 503;
    if (transient) {
      await db
        .query('delete from idempotency where person_id = $1 and endpoint = $2 and key = $3', [
          personId,
          endpoint,
          key,
        ])
        .catch(() => undefined);
      throw error;
    }
    if (error instanceof ApiError) {
      await db
        .query(
          'update idempotency set status = $4, response = $5::jsonb where person_id = $1 and endpoint = $2 and key = $3',
          [personId, endpoint, key, error.status, JSON.stringify(error.body())],
        )
        .catch(() => undefined);
      throw error;
    }
    await db
      .query('delete from idempotency where person_id = $1 and endpoint = $2 and key = $3', [
        personId,
        endpoint,
        key,
      ])
      .catch(() => undefined);
    throw error;
  }
}
