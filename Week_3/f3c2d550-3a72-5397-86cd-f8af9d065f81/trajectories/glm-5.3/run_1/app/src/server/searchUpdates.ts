// Recorded search updates: applied in order, each exactly once, by whichever app
// copy reaches search first, within the catch-up delay.

import type { Pool } from "pg";

export async function recordSearchUpdate(pool: Pool, referenceId: string, kind: "upsert" | "delete"): Promise<void> {
  await pool.query(`INSERT INTO search_updates (reference_id, kind) VALUES ($1, $2)`, [referenceId, kind]);
}

export interface RecordedUpdate { seq: string; reference_id: string; kind: string }

export async function takeRecordedUpdates(pool: Pool, limit = 500): Promise<RecordedUpdate[]> {
  const { rows } = await pool.query(
    `SELECT seq, reference_id, kind FROM search_updates ORDER BY seq ASC LIMIT $1`, [limit]);
  return rows as RecordedUpdate[];
}

export async function clearRecordedUpdates(pool: Pool, seqs: string[]): Promise<void> {
  if (seqs.length === 0) return;
  await pool.query(`DELETE FROM search_updates WHERE seq = ANY($1::bigint[])`, [seqs]);
}
