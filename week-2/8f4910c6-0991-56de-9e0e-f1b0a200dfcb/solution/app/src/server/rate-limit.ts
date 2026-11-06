// Per-address request limits counted in PostgreSQL, so every app copy shares one window.

import { ApiError } from "./errors.js";
import { exec, lockKey, rows, tx } from "./db.js";

export type RateBucket = "cast_requests" | "application_drafts";

const LIMITS: Record<RateBucket, number> = { cast_requests: 5, application_drafts: 3 };
const WINDOW_MS = 60_000;

/** Counts this request, or answers 429 with the whole seconds until the oldest counted request leaves the window. */
export async function checkRateLimit(bucket: RateBucket, address: string, now: number): Promise<void> {
  const wait = await tx(async (client) => {
    await lockKey(client, `rate:${bucket}:${address}`);
    await exec(client, "DELETE FROM rate_hits WHERE bucket = $1 AND address = $2 AND at <= $3", [
      bucket,
      address,
      new Date(now - WINDOW_MS),
    ]);
    const hits = await rows<{ at: Date }>(
      client,
      "SELECT at FROM rate_hits WHERE bucket = $1 AND address = $2 ORDER BY at",
      [bucket, address],
    );
    if (hits.length >= LIMITS[bucket]) {
      return Math.max(1, Math.ceil((hits[0].at.getTime() + WINDOW_MS - now) / 1000));
    }
    await exec(client, "INSERT INTO rate_hits (bucket, address, at) VALUES ($1, $2, $3)", [bucket, address, new Date(now)]);
    return 0;
  });
  if (wait) {
    throw new ApiError(429, "rate_limited", { retryAfterSeconds: wait }, { "Retry-After": String(wait) });
  }
}
