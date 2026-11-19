// Request rate limits: fixed windows aligned to the epoch, counted in Postgres and shared by every instance.
import { config } from "./config.js";
import { db } from "./db.js";
import { fail } from "./errors.js";
import type { Req } from "./http.js";

const CLASSES = {
  signinFailures: { limit: 5, window: () => config.signinWindowSeconds },
  join: { limit: 30, window: () => 60 },
  boardWrites: { limit: 120, window: () => 10 },
  uploads: { limit: 10, window: () => 60 },
  presence: { limit: 40, window: () => 2 },
} as const;

export type LimitClass = keyof typeof CLASSES;

function windowOf(cls: LimitClass) {
  const length = CLASSES[cls].window();
  const now = Date.now() / 1000;
  const start = Math.floor(now / length) * length;
  return { start, reset: Math.max(1, Math.ceil(start + length - now)) };
}

function setHeaders(req: Req, cls: LimitClass, count: number, reset: number) {
  const { limit } = CLASSES[cls];
  req.extraHeaders["RateLimit-Limit"] = String(limit);
  req.extraHeaders["RateLimit-Remaining"] = String(Math.max(0, limit - count));
  req.extraHeaders["RateLimit-Reset"] = String(reset);
}

function limited(req: Req, reset: number): never {
  req.extraHeaders["Retry-After"] = String(reset);
  fail("rate_limited");
}

/** Counts this request in its class; a request that finds the window full answers 429 and is not counted. */
export async function consume(req: Req, cls: LimitClass, key: string): Promise<void> {
  const { start, reset } = windowOf(cls);
  const row = await db.one<{ count: number }>(
    `INSERT INTO rate_counters (class, key, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (class, key, window_start) DO UPDATE SET count = rate_counters.count + 1 WHERE rate_counters.count < $4
     RETURNING count`,
    [cls, key, start, CLASSES[cls].limit],
  );
  if (!row) {
    setHeaders(req, cls, CLASSES[cls].limit, reset);
    limited(req, reset);
  }
  setHeaders(req, cls, row.count, reset);
}

/** Sign-in failures: checked before the credentials, counted only when they fail. */
export async function checkSigninFailures(req: Req, key: string): Promise<void> {
  const { start, reset } = windowOf("signinFailures");
  const row = await db.one<{ count: number }>("SELECT count FROM rate_counters WHERE class = $1 AND key = $2 AND window_start = $3", [
    "signinFailures",
    key,
    start,
  ]);
  const count = row?.count ?? 0;
  setHeaders(req, "signinFailures", count, reset);
  if (count >= CLASSES.signinFailures.limit) limited(req, reset);
}

export async function recordSigninFailure(req: Req, key: string): Promise<void> {
  const { start, reset } = windowOf("signinFailures");
  const row = await db.one<{ count: number }>(
    `INSERT INTO rate_counters (class, key, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (class, key, window_start) DO UPDATE SET count = rate_counters.count + 1 RETURNING count`,
    ["signinFailures", key, start],
  );
  setHeaders(req, "signinFailures", row?.count ?? 1, reset);
}

export async function pruneCounters(): Promise<void> {
  await db.run("DELETE FROM rate_counters WHERE window_start < $1", [Math.floor(Date.now() / 1000) - 2 * 86400]);
}
