/** Chapter checkpoint snapshots: stored completely or kept for retry. */

import type { Pool } from "../db/pool.js";
import { writePair, StorageUnavailableError } from "../storage/objects.js";
import { isoInstant } from "../time.js";

/** Writes the checkpoint's snapshot object, then its manifest object, then its row.
 * Returns true when the checkpoint is stored. */
export async function storeCheckpoint(pool: Pool, runId: string, n: number): Promise<boolean> {
  const run = (await pool.query<{ server_id: string; party_id: string; chapter_id: string; world_id: string; state: string }>(
    "SELECT server_id, party_id, chapter_id, world_id, state FROM chapter_runs WHERE id = $1",
    [runId]
  )).rows[0];
  if (run === undefined) return false;
  const positions = (
    await pool.query<{ character_id: string; x: number; y: number }>(
      "SELECT id AS character_id, x, y FROM characters WHERE id IN (SELECT character_id FROM party_members WHERE party_id = $1)",
      [run.party_id]
    )
  ).rows;
  const checkpoint = (
    await pool.query<{ name: string; reached: boolean; stored: boolean }>(
      "SELECT name, reached, stored FROM run_checkpoints WHERE run_id = $1 AND n = $2",
      [runId, n]
    )
  ).rows[0];
  if (checkpoint === undefined) return false;
  if (checkpoint.stored) return true;
  const snapshot = JSON.stringify({
    run_id: runId,
    checkpoint: n,
    name: checkpoint.name,
    positions,
  });
  const dataKey = `servers/${run.server_id}/chapter-runs/${runId}/checkpoints/${n}/snapshot.json`;
  const manifestKey = `servers/${run.server_id}/chapter-runs/${runId}/checkpoints/${n}/manifest.json`;
  try {
    await writePair({ kind: "chapter_checkpoint", serverId: run.server_id, dataKey, manifestKey, data: snapshot });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return false;
    throw err;
  }
  await pool.query("UPDATE run_checkpoints SET stored = true WHERE run_id = $1 AND n = $2", [runId, n]);
  return true;
}

/** Retries unstored checkpoints at least every 10 seconds on any instance. */
export async function retryCheckpoints(pool: Pool): Promise<void> {
  const rows = await pool.query<{ run_id: string; n: number; reached_at: Date | null }>(
    "SELECT run_id, n, reached_at FROM run_checkpoints WHERE reached = true AND stored = false LIMIT 5"
  );
  for (const row of rows.rows) {
    await storeCheckpoint(pool, row.run_id, row.n);
  }
}

export { isoInstant };
