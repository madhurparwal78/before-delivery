// Purge: deletes the original and display crop from storage, removes the search
// document, removes the reference's stops from every reel (adding one to each
// changed reel's version) and deletes the row.

import type { Pool } from "pg";
import { s3Delete } from "./storage.js";
import { meili, indexName } from "./search.js";
import { recordSearchUpdate } from "./searchUpdates.js";

export async function purgeReference(pool: Pool, id: string): Promise<void> {
  const { rows } = await pool.query<{ photo_content_type: string }>(
    `SELECT photo_content_type FROM "references" WHERE id = $1`, [id]);
  if (rows.length === 0) return;
  const ext = rows[0].photo_content_type === "image/png" ? "png" : "jpg";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const changedReels = await client.query<{ reel_id: string }>(
      `DELETE FROM reel_stops WHERE reference_id = $1 RETURNING reel_id`, [id]);
    for (const row of changedReels.rows) {
      await client.query(`UPDATE reels SET version = version + 1 WHERE id = $1`, [row.reel_id]);
      await client.query(
        `UPDATE reel_stops rs SET position = rs_new.rn
         FROM (SELECT id, row_number() OVER (PARTITION BY reel_id ORDER BY position) AS rn FROM reel_stops) rs_new
         WHERE rs.id = rs_new.id`, []);
    }
    await client.query(`DELETE FROM "references" WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await s3Delete(`references/${id}/original.${ext}`).catch(() => undefined);
  await s3Delete(`references/${id}/display.jpg`).catch(() => undefined);
  try {
    const task = await meili.index(indexName).deleteDocument(id);
    await meili.index(indexName).waitForTask(task.taskUid);
  } catch {
    await recordSearchUpdate(pool, id, "delete").catch(() => undefined);
  }
}
