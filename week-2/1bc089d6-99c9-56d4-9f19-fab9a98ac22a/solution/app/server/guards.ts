import { CLOCK_IS_REAL, now } from "./clock";
import { withDb, type Db } from "./db";
import { ApiError, type Reply } from "./http";
import { hashToken } from "./tokens";

const HOUR_MS = 3_600_000;
const IDEMPOTENCY_MS = 24 * HOUR_MS;

/** 8 to 64 printable ASCII characters. */
export const KEY_PATTERN = /^[\x20-\x7e]{8,64}$/;

type Limit = "saves" | "sign_ins";
const LIMITS: Record<Limit, number> = { saves: 3, sign_ins: 5 };

/**
 * Counts one accepted request for `email` against its hourly limit on the app clock, serialised per
 * address so parallel requests cannot both slip under it. Known and unknown addresses count alike, and
 * the count outlives Delete everything (it is kept under a hash, not the address). Over the limit: 429
 * with Retry-After, the whole seconds until the oldest counted request is 60 minutes old.
 */
export async function rateLimit(db: Db, limit: Limit, email: string) {
  const bucket = `${limit}:${hashToken(email)}`;
  const at = now();
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [bucket]);
  const recent = await db.query<{ at: Date }>("SELECT at FROM rate_events WHERE bucket = $1 AND at > $2 ORDER BY at", [
    bucket,
    new Date(at.getTime() - HOUR_MS),
  ]);
  if (recent.rows.length >= LIMITS[limit]) {
    const retryAfter = Math.max(1, Math.ceil((recent.rows[0].at.getTime() + HOUR_MS - at.getTime()) / 1000));
    throw new ApiError("rate_limited", undefined, { "retry-after": String(retryAfter) });
  }
  await db.query("INSERT INTO rate_events (bucket, at) VALUES ($1, $2)", [bucket, at]);
}

/**
 * Holds `key` for the whole save, across instances: requests with the same Idempotency-Key run one after
 * another, so of several arriving at once exactly one makes the draft and the email and the rest replay it.
 * The lock belongs to the connection, so it is released even if the connection breaks.
 */
export async function holdingKey<T>(db: Db, key: string, work: () => Promise<T>): Promise<T> {
  const lock = `idempotency:${key}`;
  await db.query("SELECT pg_advisory_lock(hashtext($1))", [lock]);
  try {
    return await work();
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]).catch(() => {});
  }
}

/**
 * The stored answer when the same key comes back with the same body (a replay), 409 when it comes back
 * with a different body, or null for a key not seen in the last 24 hours on the app clock.
 */
export async function replayOf(db: Db, key: string, requestHash: string): Promise<Reply | null> {
  await db.query("DELETE FROM idempotency WHERE key = $1 AND created_at <= $2", [key, new Date(now().getTime() - IDEMPOTENCY_MS)]);
  const stored = await db.query<{ request_hash: string; status: number; body: unknown }>(
    "SELECT request_hash, status, body FROM idempotency WHERE key = $1",
    [key],
  );
  const row = stored.rows[0];
  if (!row) return null;
  if (row.request_hash !== requestHash) throw new ApiError("idempotency_conflict");
  return { status: row.status, body: row.body };
}

/** Remembers a key's 202 answer (only 202 answers are remembered); remembering again updates it. */
export async function rememberReply(db: Db, key: string, requestHash: string, reply: Reply) {
  await db.query(
    `INSERT INTO idempotency (key, request_hash, status, body, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body`,
    [key, requestHash, reply.status, JSON.stringify(reply.body), now()],
  );
}

/**
 * Forgets rate-limit counts past their hour and keys past their 24 hours, so neither can count again. Only
 * while the app clock is real time: under a test clock the windowed queries above already ignore old rows.
 */
export async function forgetExpired() {
  const at = Date.now();
  await withDb(async (db) => {
    await db.query(`DELETE FROM rate_events WHERE at <= $1 AND ${CLOCK_IS_REAL}`, [new Date(at - HOUR_MS)]);
    await db.query(`DELETE FROM idempotency WHERE created_at <= $1 AND ${CLOCK_IS_REAL}`, [new Date(at - IDEMPOTENCY_MS)]);
  });
}
