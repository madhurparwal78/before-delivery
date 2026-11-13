import { createHash } from "node:crypto";
import { pool, canonical } from "./db.js";
import { config } from "./config.js";
import { ApiError, fail } from "./errors.js";
import type { ApiResult } from "./content.js";
export type Bucket = keyof typeof config.rateLimits;
// Fixed 60-second windows per bucket key, shared by every instance through PostgreSQL.
export async function countRequest(
  bucket: Bucket,
  key: string,
): Promise<Record<string, string>> {
  const limit = config.rateLimits[bucket];
  const counted = (
    await pool.query<{ count: number; reset: number }>(
      `INSERT INTO rate_limits(bucket,key,window_start,count) VALUES($1,$2,now(),1)
       ON CONFLICT(bucket,key) DO UPDATE SET
         window_start=CASE WHEN rate_limits.window_start<=now()-interval '60 seconds' THEN now() ELSE rate_limits.window_start END,
         count=CASE WHEN rate_limits.window_start<=now()-interval '60 seconds' THEN 1
                    WHEN rate_limits.count>$3 THEN rate_limits.count ELSE rate_limits.count+1 END
       RETURNING count,GREATEST(1,CEIL(EXTRACT(EPOCH FROM rate_limits.window_start+interval '60 seconds'-now())))::int AS reset`,
      [bucket, key, limit],
    )
  ).rows[0];
  const headers = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(Math.max(0, limit - counted.count)),
    "RateLimit-Reset": String(counted.reset),
  };
  if (counted.count > limit)
    fail(
      429,
      "rate_limited",
      `Too many requests. Try again in ${counted.reset} seconds.`,
      undefined,
      { ...headers, "Retry-After": String(counted.reset) },
    );
  return headers;
}
export const fingerprint = (
  method: string,
  path: string,
  body: unknown,
): string =>
  createHash("sha256")
    .update(`${method}\n${path}\n${canonical(body)}`)
    .digest("hex");
function asResult(error: unknown): ApiResult {
  if (!(error instanceof ApiError)) throw error;
  return {
    status: error.status,
    data: error.toJSON(),
    headers: error.headers,
  };
}
// Replays the first stored response for a key; a different request under the key conflicts.
export async function idempotent(
  scope: string,
  key: string | undefined,
  print: string,
  run: () => Promise<ApiResult>,
): Promise<ApiResult> {
  if (key === undefined) return run();
  if (!/^[\x21-\x7e]{1,255}$/.test(key))
    fail(
      422,
      "invalid_idempotency_key",
      "Idempotency-Key must be 1 to 255 visible ASCII characters.",
    );
  for (;;) {
    const claimed = await pool.query(
      "INSERT INTO idempotency_keys(scope,key,fingerprint,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4)) ON CONFLICT(scope,key) DO NOTHING",
      [scope, key, print, config.idempotencyTtl],
    );
    if (claimed.rowCount) break;
    const stored = (
      await pool.query<{
        fingerprint: string;
        status: number | null;
        body: string | null;
        headers: Record<string, string> | null;
        expired: boolean;
      }>(
        "SELECT fingerprint,status,body,headers,expires_at<now() AS expired FROM idempotency_keys WHERE scope=$1 AND key=$2",
        [scope, key],
      )
    ).rows[0];
    if (!stored) continue;
    if (stored.expired) {
      await pool.query(
        "DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2 AND expires_at<now()",
        [scope, key],
      );
      continue;
    }
    if (stored.fingerprint !== print)
      fail(
        409,
        "idempotency_key_reused",
        "This Idempotency-Key was already used for a different request.",
      );
    if (stored.status === null)
      fail(
        409,
        "idempotency_in_progress",
        "A request with this Idempotency-Key is still being processed.",
      );
    return {
      status: stored.status,
      data: JSON.parse(stored.body!) as unknown,
      headers: { ...stored.headers, "Idempotency-Replayed": "true" },
    };
  }
  let result: ApiResult;
  try {
    result = await run().catch(asResult);
  } catch (error) {
    await pool.query("DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2", [
      scope,
      key,
    ]);
    throw error;
  }
  const kept =
    result.status >= 200 &&
    result.status < 500 &&
    ![401, 429].includes(result.status);
  if (kept)
    await pool.query(
      "UPDATE idempotency_keys SET status=$3,body=$4,headers=$5 WHERE scope=$1 AND key=$2",
      [
        scope,
        key,
        result.status,
        JSON.stringify(result.data),
        {
          ...result.headers,
          ...(result.version !== undefined
            ? { ETag: `"${result.version}"` }
            : {}),
        },
      ],
    );
  else
    await pool.query("DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2", [
      scope,
      key,
    ]);
  return result;
}
