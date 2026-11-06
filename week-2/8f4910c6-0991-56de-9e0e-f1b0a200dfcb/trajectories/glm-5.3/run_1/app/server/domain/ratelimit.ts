import { query, one } from "../db.js";
import { errors } from "../http/errors.js";

/** Sliding window counters in PostgreSQL. */

export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<LimitResult> {
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000);
  const row = await one<{ hits: number }>(
    `INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [bucket, windowStart]
  );
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  if (row.hits <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const windowEndMs = windowStart.getTime() + windowSeconds * 1000;
  const wait = Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000));
  return { allowed: false, retryAfterSeconds: wait };
}

export function enforceRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void> {
  return checkRateLimit(bucket, limit, windowSeconds).then((r) => {
    if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
  });
}

export async function cleanupRateLimits(): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '10 minutes'`);
}
