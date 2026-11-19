import { pool } from './db.js';
import { confirmSnapshot } from './routes/snapshots.js';

/** Retries pending snapshots every 5 seconds until storage confirms them (Services). */
export async function confirmPendingSnapshots(): Promise<void> {
  const r = await pool.query<{ token: string }>(
    `SELECT token FROM snapshots WHERE input_file_id IS NULL AND NOT revoked AND expires_at > now() LIMIT 20`,
  );
  for (const row of r.rows) {
    await confirmSnapshot(row.token).catch(() => undefined);
  }
}
