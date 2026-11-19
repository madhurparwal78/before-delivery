import type { PoolClient } from 'pg';
import { pool } from '../db';
import { nowDate } from '../clock';
import { LIMITS } from '../config';
import { ApiError } from '../errors';

type Queryable = Pick<PoolClient, 'query'>;

const WINDOW_MS = 60_000;

/**
 * The one send-rate rule: at most 20 of a person's own stored sends may carry
 * a `sent_at` inside the 60 seconds up to now. The count is taken from the
 * stored messages themselves, never from a separate counter.
 */
export async function assertSendRate(authorId: string, client: Queryable = pool): Promise<void> {
  const windowStart = new Date(nowDate().getTime() - WINDOW_MS);
  const result = await client.query<{ sent_at: Date }>(
    `SELECT sent_at FROM messages
     WHERE author_id = $1 AND counted = true AND deleted = false AND sent_at > $2
     ORDER BY sent_at ASC`,
    [authorId, windowStart],
  );
  if (result.rows.length < LIMITS.sendsPerMinute) return;
  const oldest = result.rows[0]!.sent_at;
  const waitMs = oldest.getTime() + WINDOW_MS - nowDate().getTime();
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  throw new ApiError('rate_limited', { headers: { 'Retry-After': String(seconds) } });
}
