import { createHash } from 'node:crypto';
import { query, queryOne, isUniqueViolation } from '../db/pool';
import { ApiError, apiError } from './errors';
import type { HandlerResult, RequestContext } from './router';

interface RecordRow {
  body_hash: string;
  response_status: number;
  response_body: unknown;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function fingerprint(routeKey: string, body: Record<string, unknown>): string {
  return createHash('sha256').update(`${routeKey}\n${stableStringify(body)}`).digest('hex');
}

function replay(record: RecordRow): HandlerResult {
  return {
    status: record.response_status,
    json: record.response_body,
    headers: [['Idempotent-Replayed', 'true']],
  };
}

async function readRecord(userId: string, key: string): Promise<RecordRow | null> {
  return queryOne<RecordRow>(
    `SELECT body_hash, response_status, response_body
       FROM idempotency_records
      WHERE user_id = $1 AND idempotency_key = $2 AND created_at > now() - interval '24 hours'`,
    [userId, key],
  );
}

/** Replays a stored response for a repeated key, or records the fresh one. */
export async function withIdempotency(
  ctx: RequestContext,
  run: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const key = ctx.idempotencyKey;
  if (key === null) return run();
  const hash = fingerprint(ctx.routeKey, ctx.body);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await query(
        `INSERT INTO idempotency_records
           (user_id, idempotency_key, endpoint, body_hash, response_status, response_body)
         VALUES ($1, $2, $3, $4, 0, 'null'::jsonb)`,
        [ctx.actor.id, key, ctx.routeKey, hash],
      );
      break;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await readRecord(ctx.actor.id, key);
      if (!existing) {
        await query(
          'DELETE FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2',
          [ctx.actor.id, key],
        );
        continue;
      }
      if (existing.body_hash !== hash) throw apiError.idempotencyKeyReused();
      if (existing.response_status !== 0) return replay(existing);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (attempt === 49) throw apiError.conflict('idempotency_in_flight', 'That request is still in flight.');
    }
  }

  const store = async (status: number, value: unknown): Promise<void> => {
    await query(
      `UPDATE idempotency_records
          SET response_status = $3, response_body = $4::jsonb, created_at = now()
        WHERE user_id = $1 AND idempotency_key = $2`,
      [ctx.actor.id, key, status, JSON.stringify(value)],
    );
  };
  const discard = async (): Promise<void> => {
    await query('DELETE FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2', [
      ctx.actor.id,
      key,
    ]);
  };

  let result: HandlerResult;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await store(error.status, error.body());
    } else {
      await discard();
    }
    throw error;
  }

  if (result.status >= 500 || result.json === undefined) {
    await discard();
    return result;
  }
  await store(result.status, result.json);
  return result;
}
