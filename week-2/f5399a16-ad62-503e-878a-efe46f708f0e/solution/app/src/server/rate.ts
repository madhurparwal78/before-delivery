// Windows of counted events, kept in Postgres so each copy counts its own.

import { one, pool, transaction } from './db';

interface WindowRead {
  count: number;
  /** When the oldest counted event leaves the window. */
  retryAt: number;
}

export async function readWindow(key: string, windowSeconds: number, now: number): Promise<WindowRead> {
  const since = new Date(now - windowSeconds * 1000);
  const row = await one(pool, 'SELECT count(*)::int AS count, min(at) AS oldest FROM rate_events WHERE key = $1 AND at > $2', [key, since]);
  const oldest = row?.oldest ? (row.oldest as Date).getTime() : now;
  return { count: row?.count ?? 0, retryAt: oldest + windowSeconds * 1000 };
}

/** Counts one event if the window still has room, one key at a time; null when it did, the full window when it did not. */
export async function claimEvent(key: string, windowSeconds: number, limit: number, now: number): Promise<WindowRead | null> {
  return transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rate:${key}`]);
    const row = await one(tx, 'SELECT count(*)::int AS count, min(at) AS oldest FROM rate_events WHERE key = $1 AND at > $2', [key, new Date(now - windowSeconds * 1000)]);
    if ((row?.count ?? 0) >= limit) return { count: row?.count as number, retryAt: (row?.oldest as Date).getTime() + windowSeconds * 1000 };
    await tx.query('INSERT INTO rate_events (key, at) VALUES ($1, $2)', [key, new Date(now)]);
    return null;
  });
}

/** Gives back an event claimed for an action that then failed. */
export async function releaseEvent(key: string, now: number): Promise<void> {
  await pool.query('DELETE FROM rate_events WHERE ctid = (SELECT ctid FROM rate_events WHERE key = $1 AND at = $2 LIMIT 1)', [key, new Date(now)]);
}

export function retryAfterSeconds(retryAt: number, now: number): number {
  return Math.max(1, Math.ceil((retryAt - now) / 1000));
}
