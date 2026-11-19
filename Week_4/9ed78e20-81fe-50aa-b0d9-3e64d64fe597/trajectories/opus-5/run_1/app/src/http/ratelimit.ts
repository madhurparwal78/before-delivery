import { config } from '../config.js';
import { query } from '../db/pool.js';
import { errors } from './errors.js';

export type RateBucket = 'public' | 'candidate' | 'signin' | 'console_writes';

const LIMITS: Readonly<Record<RateBucket, () => number>> = {
  public: () => config.rateLimits.public,
  candidate: () => config.rateLimits.candidate,
  signin: () => config.rateLimits.signin,
  console_writes: () => config.rateLimits.consoleWrites,
};

export type RateVerdict = {
  readonly headers: Readonly<Record<string, string>>;
  readonly limited: boolean;
  readonly retryAfter: number;
};

/** Counts one request in a fixed 60-second window shared by every instance. */
export async function countRequest(
  bucket: RateBucket,
  clientKey: string,
): Promise<RateVerdict> {
  const limit = LIMITS[bucket]();
  const result = await query<{ hits: number; reset_seconds: number }>(
    `INSERT INTO rate_limit_windows (bucket, client_key, window_start, hits)
     VALUES ($1, $2, now(), 1)
     ON CONFLICT (bucket, client_key) DO UPDATE SET
       hits = CASE WHEN rate_limit_windows.window_start + interval '60 seconds' <= now()
                   THEN 1 ELSE rate_limit_windows.hits + 1 END,
       window_start = CASE WHEN rate_limit_windows.window_start + interval '60 seconds' <= now()
                   THEN now() ELSE rate_limit_windows.window_start END
     RETURNING hits,
       GREATEST(1, ceil(extract(epoch from (window_start + interval '60 seconds' - now()))))::int
         AS reset_seconds`,
    [bucket, clientKey],
  );
  const row = result.rows[0];
  const hits = row?.hits ?? 1;
  const reset = row?.reset_seconds ?? 60;
  const limited = hits > limit;
  return {
    limited,
    retryAfter: reset,
    headers: {
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(Math.max(0, limit - hits)),
      'RateLimit-Reset': String(reset),
    },
  };
}

export async function enforceRateLimit(
  bucket: RateBucket,
  clientKey: string,
): Promise<Readonly<Record<string, string>>> {
  const verdict = await countRequest(bucket, clientKey);
  if (verdict.limited) {
    throw errors.rateLimited(verdict.retryAfter, {
      ...verdict.headers,
      'Retry-After': String(verdict.retryAfter),
    });
  }
  return verdict.headers;
}
