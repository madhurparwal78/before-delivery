import { query, queryOne } from '../db.js';
import { rateLimited } from '../http/errors.js';

export type Limiter = { bucket: string; limit: number; windowSeconds: number };

/**
 * Sliding window per client address. A refused request is not counted, so the
 * wait is the time until the oldest counted request leaves the window.
 */
export async function enforceLimit(limiter: Limiter, address: string, nowMs: number): Promise<void> {
  const windowStart = new Date(nowMs - limiter.windowSeconds * 1000);
  const row = await queryOne<{ hits: number; oldest: Date | null }>(
    `SELECT count(*)::int AS hits, min(created_at) AS oldest
     FROM rate_limit_hits WHERE bucket = $1 AND address = $2 AND created_at > $3`,
    [limiter.bucket, address, windowStart],
  );
  const hits = row?.hits ?? 0;
  if (hits >= limiter.limit && row?.oldest) {
    const freeAt = row.oldest.getTime() + limiter.windowSeconds * 1000;
    throw rateLimited(Math.max(1, Math.ceil((freeAt - nowMs) / 1000)));
  }
  await query('INSERT INTO rate_limit_hits (bucket, address, created_at) VALUES ($1, $2, $3)', [
    limiter.bucket,
    address,
    new Date(nowMs),
  ]);
}
