import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import {
  rateLimitHeaders,
  rateLimitRule,
  resetSeconds,
  windowStartSeconds,
  type RateLimitClass,
  type RateLimitRule,
} from '../domain/ratelimits.js';

export interface RateLimitOutcome {
  readonly headers: Readonly<Record<string, string>>;
}

function exhausted(rule: RateLimitRule, nowMs: number): AppError {
  const reset = String(resetSeconds(rule, nowMs));
  return new AppError('rate_limited', {
    headers: { ...rateLimitHeaders(rule, rule.limit, nowMs), 'Retry-After': reset },
  });
}

/**
 * Counts one request against its class in a fixed Postgres window. A request that finds the
 * window's count already at the limit answers `rate_limited` and is not counted.
 */
export async function consumeRateLimit(limitClass: RateLimitClass, key: string, nowMs: number): Promise<RateLimitOutcome> {
  const rule = rateLimitRule(limitClass);
  const windowStart = windowStartSeconds(nowMs, rule.windowSeconds);
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limits (limit_class, limit_key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (limit_class, limit_key, window_start)
     DO UPDATE SET count = rate_limits.count + 1
       WHERE rate_limits.count < $4
     RETURNING count`,
    [limitClass, key, windowStart, rule.limit],
  );
  const row = result.rows[0];
  if (!row) throw exhausted(rule, nowMs);
  return { headers: rateLimitHeaders(rule, row.count, nowMs) };
}

/** Reads the window's count without counting the request, for the sign-in class. */
export async function peekRateLimit(limitClass: RateLimitClass, key: string, nowMs: number): Promise<RateLimitOutcome> {
  const rule = rateLimitRule(limitClass);
  const windowStart = windowStartSeconds(nowMs, rule.windowSeconds);
  const result = await pool.query<{ count: number }>(
    `SELECT count FROM rate_limits WHERE limit_class = $1 AND limit_key = $2 AND window_start = $3`,
    [limitClass, key, windowStart],
  );
  const count = result.rows[0]?.count ?? 0;
  if (count >= rule.limit) throw exhausted(rule, nowMs);
  return { headers: rateLimitHeaders(rule, count + 1, nowMs) };
}

/** Counts one failure after the fact, for the sign-in class. */
export async function recordRateLimitFailure(
  limitClass: RateLimitClass,
  key: string,
  nowMs: number,
): Promise<void> {
  const rule = rateLimitRule(limitClass);
  const windowStart = windowStartSeconds(nowMs, rule.windowSeconds);
  await pool.query(
    `INSERT INTO rate_limits (limit_class, limit_key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (limit_class, limit_key, window_start)
     DO UPDATE SET count = rate_limits.count + 1`,
    [limitClass, key, windowStart],
  );
}
