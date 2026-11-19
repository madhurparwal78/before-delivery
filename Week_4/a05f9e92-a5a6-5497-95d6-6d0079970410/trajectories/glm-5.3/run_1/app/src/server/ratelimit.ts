// Rate limiting: sliding 60-second windows on real time.
// Sign-in attempts count per username; writes count per user.

import { Db } from './db.js';

type Bucket = 'login' | 'write';

export async function checkRate(db: Db, bucket: Bucket, key: string, limit: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Date.now();
  const windowStart = now - 60_000;

  await db.query(`DELETE FROM rate_events WHERE at_ms < $1`, [windowStart - 60_000]);
  await db.query(`INSERT INTO rate_events(bucket, at_ms) VALUES ($1, $2)`, [`${bucket}:${key}`, now]);

  const res = await db.query(
    `SELECT at_ms FROM rate_events WHERE bucket = $1 AND at_ms >= $2 ORDER BY at_ms ASC`,
    [`${bucket}:${key}`, windowStart],
  );
  const events = res.rows.map((r: Record<string, unknown>) => Number(r.at_ms));

  if (events.length <= limit) return { ok: true, retryAfter: 0 };

  // <s> is the whole seconds until the oldest counted request leaves the window.
  const oldest = events[0];
  const untilGone = Math.max(1000, oldest + 60_000 - now);
  return { ok: false, retryAfter: Math.max(1, Math.ceil(untilGone / 1000)) };
}
