import type { DbClient } from './db.js';

const buckets = {
  public: { limit: 600 },
  candidate: { limit: 60 },
  signin: { limit: 20 },
  console: { limit: 120 },
} as const;

export type BucketName = keyof typeof buckets;

export type RateResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

export async function enforceRateLimit(
  client: DbClient,
  bucket: BucketName,
  key: string,
  limit: number,
  now = new Date(),
): Promise<RateResult> {
  // Fixed 60-second windows anchored at the bucket key's first request.
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const windowEnd = new Date(windowStart.getTime() + 60000);
  const reset = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
  const updated = await client.query<{ count: number }>(
    `INSERT INTO rate_limits (bucket, key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (bucket, key, window_start)
     DO UPDATE SET count = rate_limits.count + 1
     WHERE rate_limits.count < $4
     RETURNING count`,
    [bucket, key, windowStart.toISOString(), limit],
  );
  if (updated.rows.length === 0) {
    const existing = await client.query<{ count: number }>(
      `SELECT count FROM rate_limits WHERE bucket = $1 AND key = $2 AND window_start = $3`,
      [bucket, key, windowStart.toISOString()],
    );
    const count = existing.rows.length > 0 ? existing.rows[0].count : limit;
    return { allowed: false, limit, remaining: 0, reset };
  }
  const count = updated.rows[0].count;
  return { allowed: true, limit, remaining: Math.max(0, limit - count), reset };
}

export async function peekRateLimit(
  client: DbClient,
  bucket: BucketName,
  key: string,
  limit: number,
  now = new Date(),
): Promise<RateResult> {
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const windowEnd = new Date(windowStart.getTime() + 60000);
  const reset = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
  const existing = await client.query<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket = $1 AND key = $2 AND window_start = $3`,
    [bucket, key, windowStart.toISOString()],
  );
  const count = existing.rows.length > 0 ? existing.rows[0].count : 0;
  return { allowed: count < limit, limit, remaining: Math.max(0, limit - count), reset };
}

export const bucketLimits = buckets;
