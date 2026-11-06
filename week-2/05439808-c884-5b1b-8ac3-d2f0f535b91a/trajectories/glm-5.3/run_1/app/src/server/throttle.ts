// Sliding-window throttles. Checking the limit and counting the request happen together under one
// lock per limit key, so exactly the limit's count is accepted even at the same instant.
import { errors } from './errors.ts';
import { withTransaction } from './runtime.ts';

export async function checkThrottle(key: string, limit: number, windowMs: number, now: number): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('INSERT INTO throttle_keys (key, last_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, now]);
    await client.query('SELECT key FROM throttle_keys WHERE key = $1 FOR UPDATE', [key]);
    await client.query('DELETE FROM throttle_events WHERE key = $1 AND at <= $2', [key, now - windowMs]);
    const count = await client.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM throttle_events WHERE key = $1', [key]);
    if (Number(count.rows[0].count) >= limit) {
      const oldest = await client.query<{ at: string }>('SELECT at FROM throttle_events WHERE key = $1 ORDER BY at ASC LIMIT 1', [key]);
      const oldestAt = Number(oldest.rows[0].at);
      const retryAfter = Math.max(1, Math.ceil((oldestAt + windowMs - now) / 1000));
      throw errors.rateLimited(retryAfter);
    }
    await client.query('INSERT INTO throttle_events (key, at) VALUES ($1, $2)', [key, now]);
  });
}

export async function releaseThrottle(key: string, windowMs: number, now: number): Promise<void> {
  // Used when the throttled request itself fails validation, so refused requests do not count.
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM throttle_events WHERE id = (SELECT id FROM throttle_events WHERE key = $1 AND at = $2 ORDER BY id DESC LIMIT 1)',
      [key, now]
    );
  }).catch(() => undefined);
}
