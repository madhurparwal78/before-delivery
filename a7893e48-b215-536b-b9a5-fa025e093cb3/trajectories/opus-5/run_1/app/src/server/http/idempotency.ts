import { createHash } from 'node:crypto';
import { pool, queryOne } from '../db/pool.js';
import type { Ctx, Reply } from './context.js';
import {
  idempotencyKeyRequired,
  idempotencyKeyReused,
  requestInProgress,
} from './errors.js';
import type { Actor } from './session.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
}

interface RecordRow {
  body_hash: string;
  state: string;
  response_status: number | null;
  response_body: string | null;
}

/**
 * One 2xx per key: replays return the stored response, a different body with a
 * live key is refused, and errors are never stored.
 */
export async function runIdempotent(
  ctx: Ctx,
  actor: Actor,
  run: () => Promise<Reply>,
): Promise<Reply> {
  const key = ctx.header('idempotency-key');
  if (key === null || !KEY_PATTERN.test(key)) throw idempotencyKeyRequired();
  const path = ctx.url.pathname;
  const bodyHash = createHash('sha256').update(canonical(ctx.body())).digest('hex');

  const claimed = await queryOne<{ idempotency_key: string }>(
    pool,
    `INSERT INTO idempotency_records (user_id, path, idempotency_key, body_hash, state)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (user_id, path, idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [actor.id, path, key, bodyHash],
  );

  if (claimed === null) {
    const existing = await queryOne<RecordRow>(
      pool,
      `SELECT body_hash, state, response_status, response_body
         FROM idempotency_records WHERE user_id = $1 AND path = $2 AND idempotency_key = $3`,
      [actor.id, path, key],
    );
    if (existing === null) throw requestInProgress();
    if (existing.body_hash !== bodyHash) throw idempotencyKeyReused();
    if (existing.state === 'in_progress') throw requestInProgress();
    return {
      status: existing.response_status ?? 200,
      body: existing.response_body === null ? undefined : (JSON.parse(existing.response_body) as unknown),
    };
  }

  try {
    const reply = await run();
    if (reply.status >= 200 && reply.status < 300) {
      await pool.query(
        `UPDATE idempotency_records SET state = 'done', response_status = $4, response_body = $5
           WHERE user_id = $1 AND path = $2 AND idempotency_key = $3`,
        [
          actor.id,
          path,
          key,
          reply.status,
          reply.body === undefined ? null : JSON.stringify(reply.body),
        ],
      );
    } else {
      await discard(actor.id, path, key);
    }
    return reply;
  } catch (error) {
    await discard(actor.id, path, key);
    throw error;
  }
}

async function discard(userId: string, path: string, key: string): Promise<void> {
  await pool.query(
    `DELETE FROM idempotency_records WHERE user_id = $1 AND path = $2 AND idempotency_key = $3`,
    [userId, path, key],
  );
}
