// Sliding-window limits kept in PostgreSQL, keyed on a partner key or a member, never on the network address.
import { lockName, one, tx } from "./db.js";
import { refuse } from "./errors.js";

export interface Limit {
  name: string;
  max: number;
  windowSeconds: number;
}

/** Refuses with 429 and a whole-second Retry-After while the window holds `max` counted requests; else counts this one when asked. */
export async function spend(limit: Limit, count: boolean): Promise<void> {
  await tx(async (db) => {
    await lockName(db, `limit:${limit.name}`);
    const now = Date.now();
    const windowStart = new Date(now - limit.windowSeconds * 1000);
    await db.query("DELETE FROM rate_events WHERE limiter = $1 AND at <= $2", [limit.name, windowStart]);
    const used = await one<{ n: number; oldest: Date | null }>(db,
      "SELECT count(*)::int AS n, min(at) AS oldest FROM rate_events WHERE limiter = $1", [limit.name]);
    if (used!.n >= limit.max) {
      const leaves = used!.oldest!.getTime() + limit.windowSeconds * 1000;
      throw refuse.rateLimited(Math.max(1, Math.ceil((leaves - now) / 1000)));
    }
    if (count) await db.query("INSERT INTO rate_events (limiter, at) VALUES ($1, $2)", [limit.name, new Date(now)]);
  });
}

/** Counts one use after it succeeded. */
export async function record(limit: Limit): Promise<void> {
  await tx((db) => db.query("INSERT INTO rate_events (limiter, at) VALUES ($1, now())", [limit.name]));
}
