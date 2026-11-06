import { config, type RateBucket, type RateScope } from './config.js';
import { now } from './clock.js';
import { query, queryOne, withTransaction } from './db.js';
import { ApiError } from './errors.js';

/**
 * Request allowances. Each holds up to its capacity in tokens and refills
 * continuously, with fractional tokens stored in one shared Postgres row. Capacity and
 * refill come from the environment of the instance handling the request; refill never
 * runs backward across instances with different clocks.
 */
export interface AllowanceReading {
  bucket: RateBucket;
  scope: RateScope;
  allowed: boolean;
  capacity: number;
  refillPerMinute: number;
  tokens: number;
  /** Any lead the stored instant holds over this instance's clock, in seconds. */
  leadSeconds: number;
}

function bucketKey(bucket: RateBucket, scope: RateScope, key: string): string {
  return `${bucket}:${scope}:${key}`;
}

export async function consumeAllowance(
  bucket: RateBucket,
  scope: RateScope,
  key: string,
): Promise<AllowanceReading | null> {
  const setting = config.rateLimit(bucket, scope);
  if (setting === null) return null;
  const instant = now();
  const rowKey = bucketKey(bucket, scope, key);

  return await withTransaction(async (db) => {
    await query(
      db,
      `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at) VALUES ($1,$2,$3)
       ON CONFLICT (bucket_key) DO NOTHING`,
      [rowKey, setting.capacity, instant],
    );
    const stored = await queryOne<{ tokens: number; updated_at: Date }>(
      db,
      'SELECT tokens, updated_at FROM rate_limit_buckets WHERE bucket_key = $1 FOR UPDATE',
      [rowKey],
    );
    if (stored === null) throw new Error('allowance row vanished');

    const elapsedSeconds = Math.max(0, (instant.getTime() - stored.updated_at.getTime()) / 1000);
    const refilled = stored.tokens + (elapsedSeconds * setting.refillPerMinute) / 60;
    // The stored count is capped at the handling instance's capacity before a token is taken.
    const capped = Math.min(refilled, setting.capacity);
    const leadMs = Math.max(0, stored.updated_at.getTime() - instant.getTime());
    const allowed = capped >= 1;
    const remaining = allowed ? capped - 1 : capped;
    // The stored instant never moves backward.
    const storedInstant = new Date(Math.max(stored.updated_at.getTime(), instant.getTime()));

    await query(
      db,
      'UPDATE rate_limit_buckets SET tokens = $2, updated_at = $3 WHERE bucket_key = $1',
      [rowKey, remaining, storedInstant],
    );

    return {
      bucket,
      scope,
      allowed,
      capacity: setting.capacity,
      refillPerMinute: setting.refillPerMinute,
      tokens: remaining,
      leadSeconds: leadMs / 1000,
    };
  });
}

export function retryAfterSeconds(reading: AllowanceReading): number {
  const wait = ((1 - reading.tokens) * 60) / reading.refillPerMinute + reading.leadSeconds;
  return Math.max(1, Math.ceil(wait));
}

export function resetSeconds(reading: AllowanceReading): number {
  const wait =
    ((reading.capacity - reading.tokens) * 60) / reading.refillPerMinute + reading.leadSeconds;
  return Math.max(0, Math.ceil(wait));
}

export function allowanceHeaders(reading: AllowanceReading): Record<string, string> {
  return {
    'RateLimit-Limit': String(reading.capacity),
    'RateLimit-Remaining': String(Math.floor(Math.max(0, reading.tokens))),
    'RateLimit-Reset': String(resetSeconds(reading)),
  };
}

export function rateLimited(reading: AllowanceReading): ApiError {
  return new ApiError(
    429,
    'rate_limited',
    { bucket: reading.bucket, scope: reading.scope },
    { 'Retry-After': String(retryAfterSeconds(reading)), ...allowanceHeaders(reading) },
  );
}

/** Of the allowances a request reached, the headers describe the one with fewer remaining; a tie reports the user allowance. */
export function headerReading(
  readings: readonly (AllowanceReading | null)[],
): AllowanceReading | null {
  const present = readings.filter((reading): reading is AllowanceReading => reading !== null);
  if (present.length === 0) return null;
  let best = present[0] as AllowanceReading;
  for (const reading of present.slice(1)) {
    const fewer = Math.floor(reading.tokens) < Math.floor(best.tokens);
    const tieToUser = Math.floor(reading.tokens) === Math.floor(best.tokens) && reading.scope === 'user';
    if (fewer || tieToUser) best = reading;
  }
  return best;
}

/**
 * The vet-link guess limit. A miss is a vet read answered 404; it counts for the 60
 * seconds after it was answered, shared by every instance on the database.
 */
const VET_MISS_WINDOW_SECONDS = 60;
const VET_MISS_LIMIT = 10;

export async function recordVetMiss(address: string): Promise<void> {
  const instant = now();
  await withTransaction(async (db) => {
    await query(db, 'INSERT INTO vet_link_misses (address, at) VALUES ($1,$2)', [address, instant]);
    await query(db, 'DELETE FROM vet_link_misses WHERE at < $1', [
      new Date(instant.getTime() - VET_MISS_WINDOW_SECONDS * 1000 * 10),
    ]);
  });
}

/** Returns the Retry-After seconds while the limit applies, or null when it does not. */
export async function vetGuessLimit(address: string): Promise<number | null> {
  const instant = now();
  const since = new Date(instant.getTime() - VET_MISS_WINDOW_SECONDS * 1000);
  const row = await withTransaction((db) =>
    queryOne<{ misses: number; oldest: Date | null }>(
      db,
      `SELECT COUNT(*)::int AS misses, MIN(at) AS oldest
       FROM vet_link_misses WHERE address = $1 AND at >= $2`,
      [address, since],
    ),
  );
  if (row === null || row.misses < VET_MISS_LIMIT || row.oldest === null) return null;
  const clearsAt = row.oldest.getTime() + VET_MISS_WINDOW_SECONDS * 1000;
  return Math.max(1, Math.ceil((clearsAt - instant.getTime()) / 1000));
}
