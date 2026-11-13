import { inUnit } from "../db/unit";
import { ApiError } from "../http/fail";

/** Counts one request in a sliding window; the request after the limit answers 429 with the seconds left. */
export async function consumeRate(bucket: string, limit: number, windowSeconds: number): Promise<void> {
  await inUnit(async (unit) => {
    await unit.query("SELECT pg_advisory_xact_lock(hashtext($1))", [bucket]);
    const window = await unit.first<{ used: number; wait: number | null }>(
      `SELECT count(*)::int AS used,
              extract(epoch FROM (min(at) + make_interval(secs => $3) - app_now()))::float AS wait
         FROM rate_events WHERE bucket = $1 AND at > app_now() - make_interval(secs => $2)`,
      [bucket, windowSeconds, windowSeconds],
    );
    if (window && window.used >= limit) throw new ApiError("rate_limited", {}, { retryAfter: window.wait ?? windowSeconds });
    await unit.query("INSERT INTO rate_events (bucket, at) VALUES ($1, app_now())", [bucket]);
  });
}
