import { deleteExpiredSessions } from "./auth";
import { pool } from "./db";
import { sweepPackets } from "./packets";
import { writeSeededStrokes } from "./seed";
import { deleteObject } from "./storage";

/** Removals a refusing storage didn't finish are retried from Postgres, so a restart can't lose them. */
async function retryRemovals(): Promise<void> {
  const { rows } = await pool.query<{ key: string }>("SELECT key FROM pending_removals ORDER BY created_at LIMIT 100");
  for (const { key } of rows) {
    try {
      await deleteObject(key);
      await pool.query("DELETE FROM pending_removals WHERE key = $1", [key]);
    } catch {
      return;
    }
  }
}

let seedDone = false;

async function tick(): Promise<void> {
  const work: Promise<unknown>[] = [sweepPackets(), retryRemovals(), deleteExpiredSessions()];
  if (!seedDone) work.push(writeSeededStrokes().then((done) => (seedDone = done)));
  await Promise.allSettled(work);
}

export function startJobs(): void {
  void tick();
  setInterval(() => void tick(), 10_000).unref();
}
