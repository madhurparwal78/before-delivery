import { pool, publish } from "./db.ts";
import { snapshotKey, storeOnce, StorageUnreachable } from "./storage.ts";

// Locked-team snapshots: written once after the lock commits; the receipt reads "stored" only after
// MinIO confirms. While MinIO is unreachable the writer retries every 5 seconds (brief: Services / MinIO).

let running = false;

export async function writeSnapshots(): Promise<void> {
  if (running) return;
  running = true;
  const db = await pool.connect();
  try {
    for (;;) {
      await db.query("BEGIN");
      const due = await db.query<{ manager_id: string; gameweek: number; snapshot_body: string }>(
        "SELECT manager_id, gameweek, snapshot_body FROM locked_teams WHERE receipt = 'pending' ORDER BY gameweek, manager_id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      const row = due.rows[0];
      try {
        if (!row) return;
        await storeOnce(snapshotKey(row.gameweek, row.manager_id), row.snapshot_body);
        await db.query("UPDATE locked_teams SET receipt = 'stored' WHERE manager_id = $1 AND gameweek = $2", [row.manager_id, row.gameweek]);
        await publish(db, { t: "receipt", manager: row.manager_id });
      } finally {
        await db.query("COMMIT");
      }
    }
  } catch (error) {
    if (!(error instanceof StorageUnreachable)) console.error("snapshot writer:", (error as Error).message);
  } finally {
    db.release();
    running = false;
  }
}

export function startSnapshotWriter(): void {
  setInterval(() => void writeSnapshots(), 5000).unref();
}
