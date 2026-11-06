import type { App } from './api.js';
import { holdQuery } from './holds.js';
import { deleteObject } from './minio.js';

/**
 * The timed sweep, run at least every 10 seconds:
 * - lapsed live holds move up the next waiting hold;
 * - ended private pages are marked ended;
 * - closed charters' guest passport data is erased after the retention time.
 */
export async function sweep(app: App): Promise<void> {
  const client = await app.pool.connect();
  const photoKeys: string[] = [];
  try {
    await client.query('BEGIN');
    const lapsed = await client.query<{ id: string; yacht_slug: string; week_start: string }>(
      "UPDATE holds SET status = 'lapsed' WHERE status = 'live' AND lapses_at <= now() RETURNING id, yacht_slug, week_start",
    );
    for (const row of lapsed.rows) {
      const next = await client.query<{ id: string }>(
        holdQuery("WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' ORDER BY position ASC, placed_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED"),
        [row.yacht_slug, row.week_start],
      );
      if (next.rows.length === 0) continue;
      await client.query(
        "UPDATE holds SET status = 'live', live_since = now(), lapses_at = now() + make_interval(secs => $1), position = NULL WHERE id = $2",
        [app.config.timers.holdSeconds, next.rows[0].id],
      );
      await client.query(
        "UPDATE holds SET position = position - 1 WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' AND id <> $3",
        [row.yacht_slug, row.week_start, next.rows[0].id],
      );
    }
    await client.query("UPDATE private_pages SET status = 'ended' WHERE status = 'live' AND ends_at <= now()");
    await client.query(
      "UPDATE private_pages SET status = 'ended' WHERE kind = 'manifest' AND status = 'live' AND charter_id IN (SELECT id FROM charters WHERE status = 'closed')",
    );
    // Erasure: only guest names remain.
    const due = await client.query<{ id: string; photo_key: string | null }>(
      "UPDATE guests SET nationality = NULL, date_of_birth = NULL, passport_number = NULL, photo_key = NULL, photo_type = NULL WHERE charter_id IN (SELECT id FROM charters WHERE erases_at IS NOT NULL AND erases_at <= now()) RETURNING id, photo_key",
    );
    for (const g of due.rows) {
      if (g.photo_key) photoKeys.push(g.photo_key);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
  for (const key of photoKeys) {
    try {
      await deleteObject(app.config, key);
    } catch {
      // best effort; the database copy is already erased
    }
  }
}
