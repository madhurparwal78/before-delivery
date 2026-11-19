import { config } from "./config";
import { now, transaction, type Queryable } from "./db";
import { ApiError } from "./http";
import { addSeconds, atLisbon } from "./figures";

export type RateKind = "request" | "download";

const LIMITS: Record<RateKind, { limit: number; window: number; copy: (time: string) => string }> = {
  request: {
    limit: 20,
    window: config.requestRateWindowSeconds,
    copy: (time) => `Too many requests for now. You can send another at ${time} Lisbon time.`,
  },
  download: {
    limit: 5,
    window: config.fileRateWindowSeconds,
    copy: (time) => `Too many downloads for now. You can download another at ${time} Lisbon time.`,
  },
};

/** Keyed on the desk, whichever session or network address asks. */
export async function rateCheck(db: Queryable, assessorId: string, kind: RateKind): Promise<void> {
  const { limit, window, copy } = LIMITS[kind];
  const at = now();
  const windowStart = addSeconds(at, -window);
  const { rows } = await db.query(
    `SELECT at FROM rate_events WHERE assessor_id = $1 AND kind = $2 AND at > $3 ORDER BY at`,
    [assessorId, kind, windowStart],
  );
  if (rows.length < limit) return;
  const freeAt = addSeconds(rows[rows.length - limit].at as Date, window);
  const retryAfter = Math.max(1, Math.ceil((freeAt.getTime() - at.getTime()) / 1000));
  throw new ApiError(429, "rate_limited", copy(atLisbon(addSeconds(at, retryAfter))), undefined, undefined, {
    "Retry-After": String(retryAfter),
  });
}

/** Spends one of the desk's allowance; the desk row lock makes the check hold under concurrent sends. */
export async function rateSpend(tx: Queryable, assessorId: string, kind: RateKind): Promise<void> {
  await tx.query(`SELECT id FROM assessors WHERE id = $1 FOR UPDATE`, [assessorId]);
  await rateCheck(tx, assessorId, kind);
  await tx.query(`INSERT INTO rate_events (assessor_id, kind, at) VALUES ($1, $2, $3)`, [assessorId, kind, now()]);
}

/** A download spends its allowance in a transaction of its own, so the desk row lock holds from check to spend. */
export function spendDownload(assessorId: string): Promise<void> {
  return transaction((tx) => rateSpend(tx, assessorId, "download"));
}
