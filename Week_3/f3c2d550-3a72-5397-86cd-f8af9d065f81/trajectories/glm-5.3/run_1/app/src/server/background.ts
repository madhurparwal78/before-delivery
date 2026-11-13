// Shared background work: status checks, purge sweeps, sheet rendering, search
// catch-up and index rebuild, and idempotency sweeps. Each unit of work is
// decided by the shared records, so whichever copies are running it runs once.

import type { Pool } from "pg";
import type { ServerClock } from "./clock.js";
import { checkAll, statuses } from "./status.js";
import { purgeReference } from "./purge.js";
import { renderSheet } from "./sheetRender.js";
import { takeRecordedUpdates, clearRecordedUpdates } from "./searchUpdates.js";
import { meili, indexName, ensureIndexSettings, searchDoc } from "./search.js";
import { listStored } from "./repo.js";
import { applyDueZoneChange } from "./settings.js";
import { idempotencySweep } from "./idempotency.js";

function every(ms: number, fn: () => Promise<void>): void {
  const tick = async () => {
    try { await fn(); } catch { /* retried on the next tick */ }
    setTimeout(tick, ms).unref?.();
  };
  setTimeout(tick, ms).unref?.();
}

export function startBackground(pool: Pool, clock: ServerClock): void {
  // Service status: checked at least every 5 seconds.
  every(5_000, async () => { await checkAll(); });

  // Purge sweeps: every reference past its purge_at within 5 seconds.
  every(5_000, async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM "references" WHERE state = 'trashed' AND purge_at <= now()`);
    for (const row of rows) {
      await purgeReference(pool, row.id);
    }
    await idempotencySweep(pool);
    await applyDueZoneChange(pool, clock.nowMs());
  });

  // Sheets: queued sheets render within 5 seconds when printing and storage are up.
  every(5_000, async () => {
    if (!statuses.printing || !statuses.storage) return;
    const claimed = await pool.query(
      `UPDATE sheets SET state = 'rendering'
       WHERE id IN (SELECT id FROM sheets WHERE state = 'queued' ORDER BY requested_at LIMIT 1)
       RETURNING id`);
    if (claimed.rows.length === 0) return;
    await renderSheet(pool, claimed.rows[0].id as string);
  });

  // Search catch-up: recorded updates applied in order within 30 seconds.
  every(5_000, async () => {
    if (!statuses.search) return;
    const updates = await takeRecordedUpdates(pool);
    if (updates.length === 0) return;
    for (const u of updates) {
      if (u.kind === "delete") {
        const task = await meili.index(indexName).deleteDocument(u.reference_id);
        await meili.index(indexName).waitForTask(task.taskUid);
      } else {
        const { rows } = await pool.query(
          `SELECT id, state, version, title, maker, year, materials, finish, colour_family,
             source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
             swatch, swatch_source, captured_at, trashed_at, purge_at,
             photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height
           FROM "references" WHERE id = $1 AND state = 'stored'`, [u.reference_id]);
        if (rows.length === 0) {
          const task = await meili.index(indexName).deleteDocument(u.reference_id);
          await meili.index(indexName).waitForTask(task.taskUid);
        } else {
          const task = await meili.index(indexName).addDocuments([searchDoc(rows[0] as never)]);
          await meili.index(indexName).waitForTask(task.taskUid);
        }
      }
      await clearRecordedUpdates(pool, [u.seq]);
    }
  });

  // Index check and rebuild: a missing index is recreated and rebuilt within 30 seconds.
  every(5_000, async () => {
    try {
      const health = await meili.health();
      if (health.status !== "available") { statuses.search = false; return; }
      let exists = true;
      try { await meili.index(indexName).getStats(); } catch { exists = false; }
      if (exists) { statuses.search = true; return; }
      statuses.search = false;
      await ensureIndexSettings();
      const refs = await listStored(pool);
      const task = await meili.index(indexName).addDocuments(refs.map(searchDoc));
      await meili.index(indexName).waitForTask(task.taskUid);
      statuses.search = true;
    } catch {
      statuses.search = false;
    }
  });
}
