import { config } from "./config.js";
import { transaction } from "./db.js";
import { rateLimited } from "./errors.js";

/** A sliding window per bucket: the request over the limit learns how long until the oldest hit leaves the window. */
export async function checkRate(bucket: string, limit: number, nowMs: number): Promise<void> {
  const windowMs = config.seconds.rateWindow * 1000;
  const retryAfter = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [bucket]);
    await client.query("DELETE FROM rate_hits WHERE bucket = $1 AND at <= $2", [bucket, nowMs - windowMs]);
    const counted = await client.query("SELECT count(*)::int AS hits, min(at) AS oldest FROM rate_hits WHERE bucket = $1", [bucket]);
    const row = counted.rows[0] as { hits: number; oldest: number | null };
    if (row.hits >= limit && row.oldest !== null) return Math.max(1, Math.ceil((row.oldest + windowMs - nowMs) / 1000));
    await client.query("INSERT INTO rate_hits (bucket, at) VALUES ($1, $2)", [bucket, nowMs]);
    return 0;
  });
  if (retryAfter > 0) throw rateLimited(retryAfter);
}
