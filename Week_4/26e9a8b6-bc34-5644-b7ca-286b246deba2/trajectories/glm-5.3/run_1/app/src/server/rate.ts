// Server-side rolling windows for sign-in, resend and question limits.

import type { Db } from './db';

interface KeyRow {
  key: string;
  window_start: Date;
  count: number;
}

/** Records an event and reports whether the window allows it. */
export async function checkRate(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  record: boolean,
): Promise<{ allowed: boolean; retryAfter: number }> {
  return db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const existing = await client.query<KeyRow>('SELECT key, window_start, count FROM rate_events WHERE key = $1 FOR UPDATE', [key]);
    const now = Date.now();
    if (existing.rows.length === 0) {
      if (record) {
        await client.query('INSERT INTO rate_events (key, window_start, count) VALUES ($1, $2, 1)', [key, new Date(now)]);
      }
      return { allowed: true, retryAfter: 0 };
    }
    const row = existing.rows[0];
    const elapsed = (now - row.window_start.getTime()) / 1000;
    if (elapsed >= windowSeconds) {
      if (record) {
        await client.query('UPDATE rate_events SET window_start = $2, count = 1 WHERE key = $1', [key, new Date(now)]);
      }
      return { allowed: true, retryAfter: 0 };
    }
    if (row.count < limit) {
      if (record) {
        await client.query('UPDATE rate_events SET count = count + 1 WHERE key = $1', [key]);
      }
      return { allowed: true, retryAfter: 0 };
    }
    return { allowed: false, retryAfter: Math.ceil(windowSeconds - elapsed) };
  });
}
