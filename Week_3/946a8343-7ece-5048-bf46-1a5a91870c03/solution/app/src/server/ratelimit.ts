// Fixed 60 s windows on the server clock, counted in Postgres: writes per user and sign-ins per username.
import { db } from "./db.ts";
import { now } from "./clock.ts";
import { rateLimited } from "./errors.ts";

const WINDOW_MS = 60_000;

export async function hit(bucket: string, limit: number): Promise<void> {
  const at = now();
  const minute = Math.floor(at / WINDOW_MS);
  const { hits } = await db.one<{ hits: number }>(
    `INSERT INTO rate_hits (bucket, minute, hits) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, minute) DO UPDATE SET hits = rate_hits.hits + 1 RETURNING hits`,
    [bucket, minute],
  );
  // The first hit of a bucket in a minute also drops the windows that have ended.
  if (hits === 1) await db.q("DELETE FROM rate_hits WHERE minute < $1", [minute]);
  if (hits > limit) throw rateLimited(Math.max(1, Math.ceil(((minute + 1) * WINDOW_MS - at) / 1000)));
}
