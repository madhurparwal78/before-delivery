import { pool, queryOne } from '../db/pool.js';
import { hashBody } from '../domain/secrets.js';
import { ApiFailure, failures } from './errors.js';
import type { Ctx, Reply } from './context.js';

const KEY_HEADER = 'idempotency-key';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function readKey(ctx: Ctx): string {
  const raw = ctx.req.headers[KEY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string' || key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw failures.validation({
      'Idempotency-Key': 'Send an Idempotency-Key of 1 to 100 printable ASCII characters.',
    });
  }
  return key;
}

interface RecordRow {
  method: string;
  path: string;
  body_hash: string;
  status: number | null;
  response: unknown;
}

/**
 * A key is scoped to the signed-in user. Repeating the same key with the same
 * method, path and body returns exactly the stored response and changes nothing
 * more; the same key with a different path or body is refused.
 */
export async function withIdempotency(ctx: Ctx, userId: string, run: () => Promise<Reply>): Promise<Reply> {
  const key = readKey(ctx);
  const method = ctx.req.method;
  const path = ctx.req.originalUrl.split('?')[0];
  const bodyHash = hashBody(stableStringify(ctx.body));

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const inserted = await pool.query(
      `INSERT INTO idempotency_records (user_id, key, method, path, body_hash, status, response, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
       ON CONFLICT (user_id, key) DO NOTHING`,
      [userId, key, method, path, bodyHash, ctx.now],
    );
    if (inserted.rowCount === 1) {
      try {
        const reply = await run();
        await pool.query(
          'UPDATE idempotency_records SET status = $3, response = $4 WHERE user_id = $1 AND key = $2',
          [userId, key, reply.status, JSON.stringify(reply.body)],
        );
        return reply;
      } catch (error) {
        await pool.query('DELETE FROM idempotency_records WHERE user_id = $1 AND key = $2', [
          userId,
          key,
        ]);
        throw error;
      }
    }

    const stored = await queryOne<RecordRow>(
      pool,
      'SELECT method, path, body_hash, status, response FROM idempotency_records WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    if (!stored) continue;
    if (stored.method !== method || stored.path !== path || stored.body_hash !== bodyHash) {
      throw failures.idempotencyKeyReused();
    }
    if (stored.status !== null) return { status: stored.status, body: stored.response };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new ApiFailure('validation', 'That request is still in flight. Try again shortly.', {
    errors: { 'Idempotency-Key': 'That request is still in flight.' },
  });
}
