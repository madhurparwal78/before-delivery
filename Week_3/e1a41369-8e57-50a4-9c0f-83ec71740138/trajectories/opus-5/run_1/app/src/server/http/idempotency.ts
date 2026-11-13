import { createHash } from 'node:crypto';
import { query } from '../db.js';
import { fail } from './errors.js';
import type { Ctx } from './core.js';

export interface StoredResponse {
  status: number;
  body: unknown;
  /** The stored JSON text, replayed byte for byte. */
  text?: string;
}

export function replyStored(ctx: Ctx, stored: StoredResponse): void {
  if (stored.text === undefined) ctx.send(stored.status, stored.body);
  else ctx.sendJsonText(stored.status, stored.text);
}

/**
 * Runs a score, complete, uncomplete or buy exactly once per Idempotency-Key.
 * A repeat returns the stored response; the same key with another request is refused.
 */
export async function onceWithKey(
  ctx: Ctx,
  userId: string,
  work: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const key = ctx.idempotencyKey;
  if (!key) return work();

  const bodyHash = createHash('sha256').update(ctx.rawBody).digest('hex');
  const existing = await query<{ method: string; path: string; body_hash: string; status: number; response: string }>(
    'select method, path, body_hash, status, response from idempotency_records where user_id = $1 and key = $2',
    [userId, key],
  );
  const record = existing.rows[0];
  if (record) {
    if (record.method !== ctx.method || record.path !== ctx.path || record.body_hash !== bodyHash) {
      throw fail('idempotency_key_reused');
    }
    return { status: record.status, body: JSON.parse(record.response), text: record.response };
  }

  const result = await work();
  await query(
    `insert into idempotency_records (user_id, key, method, path, body_hash, status, response)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
    [userId, key, ctx.method, ctx.path, bodyHash, result.status, JSON.stringify(result.body)],
  );
  return result;
}
