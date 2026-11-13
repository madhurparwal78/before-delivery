import { config } from "./config";
import { now } from "./clock";
import { one, rows, transaction } from "./db";

const WINDOW_MS = 60_000;

/** Counts a public parts-list request for a caller in the shared window; returns Retry-After seconds when refused. */
export async function refuseAfterRate(caller: string): Promise<number | null> {
  const limit = config.desk.partsRatePerMinute;
  const at = now();
  return transaction(async (db) => {
    await rows(db, "SELECT pg_advisory_xact_lock(hashtext($1))", [caller]);
    await rows(db, "DELETE FROM rate_hits WHERE caller = $1 AND at <= $2", [caller, new Date(at.getTime() - WINDOW_MS)]);
    const window = await one<{ n: number; oldest: Date | null }>(db, "SELECT count(*)::int AS n, min(at) AS oldest FROM rate_hits WHERE caller = $1", [caller]);
    if (limit === 0) return 60;
    if ((window?.n ?? 0) >= limit) {
      const oldest = window?.oldest ?? at;
      return Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MS - at.getTime()) / 1000));
    }
    await rows(db, "INSERT INTO rate_hits (caller, at) VALUES ($1, $2)", [caller, at]);
    return null;
  });
}
