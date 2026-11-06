// Timed work on the server, every 2 seconds: hold lapses and move-ups, manifest erasure, and pruning of
// broker rate-limit counts. Page endings and session endings are judged at each request.
import { config } from "./config";
import { pool, rows, transaction } from "./db";
import { sweepLapses } from "./domain/holds";
import { deleteObject } from "./storage";

const EVERY_MS = 2000;

/** Erases passport details and photos of charters whose retention has run out; only names remain. */
async function sweepErasure(): Promise<void> {
  const due = await rows<{ id: string }>(pool, "SELECT id FROM charters WHERE status = 'closed' AND NOT erased AND erases_at <= now()");
  for (const charter of due) {
    await transaction(async (db) => {
      const photos = await rows<{ photo_key: string }>(db, "SELECT photo_key FROM guests WHERE charter_id = $1 AND photo_key IS NOT NULL FOR UPDATE", [charter.id]);
      for (const photo of photos) await deleteObject(photo.photo_key);
      await db.query(
        "UPDATE guests SET nationality = NULL, date_of_birth = NULL, passport_number = NULL, photo_key = NULL, photo_type = NULL WHERE charter_id = $1",
        [charter.id],
      );
      await db.query("UPDATE charters SET erased = true WHERE id = $1", [charter.id]);
    });
  }
}

async function pruneRateCounts(): Promise<void> {
  await pool.query("DELETE FROM broker_hold_requests WHERE requested_at < now() - make_interval(secs => $1)", [config.timers.brokerRateWindowSeconds]);
}

export function startSweep(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    for (const task of [sweepLapses, sweepErasure, pruneRateCounts]) {
      await task().catch((error: Error) => console.error(`sweep: ${error.message}`));
    }
    running = false;
  }, EVERY_MS);
}
