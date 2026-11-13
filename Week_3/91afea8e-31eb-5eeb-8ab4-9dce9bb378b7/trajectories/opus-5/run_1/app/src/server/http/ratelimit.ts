/** Counted windows in Postgres, one bucket per limit and one key per caller. */

import { config } from '../config.js';
import { one, query } from '../db.js';
import { rateLimited } from './errors.js';

export type RateBucket = 'pincode' | 'shared' | 'coupon' | 'giftcard';

const LIMITS: Record<RateBucket, number> = {
  pincode: 30,
  shared: 30,
  coupon: 10,
  giftcard: 10,
};

export async function enforceRateLimit(bucket: RateBucket, key: string): Promise<void> {
  const window = String(config.rateWindowSeconds);
  const row = await one<{ used: number; oldest: string | null }>(
    `SELECT count(*)::int AS used, min(at)::text AS oldest
       FROM rate_events
      WHERE bucket = $1 AND key = $2 AND at > now() - ($3 || ' seconds')::interval`,
    [bucket, key, window],
  );
  const used = row === null ? 0 : row.used;
  if (used >= LIMITS[bucket]) {
    const left = await one<{ retry_after: number }>(
      `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (min(at) + ($3 || ' seconds')::interval - now()))))::int AS retry_after
         FROM rate_events
        WHERE bucket = $1 AND key = $2 AND at > now() - ($3 || ' seconds')::interval`,
      [bucket, key, window],
    );
    throw rateLimited(left === null ? config.rateWindowSeconds : left.retry_after);
  }
  await query('INSERT INTO rate_events (bucket, key) VALUES ($1, $2)', [bucket, key]);
}
