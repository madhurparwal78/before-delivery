import type { Db } from "./db.js";

export interface ExtractStatePayload {
  source: string;
  state: "live" | "refreshing" | "refresh_failed";
  stale: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  next_run_at: string | null;
  rows: number;
}

export async function extractPayload(db: Db, sourceId: string): Promise<ExtractStatePayload> {
  const res = await db.query("SELECT * FROM extracts WHERE source_id = $1", [sourceId]);
  const row = res.rows[0];
  if (!row) {
    return { source: sourceId, state: "live", stale: false, last_success_at: null, last_failure_at: null, next_run_at: null, rows: 0 };
  }
  return {
    source: sourceId,
    state: row.state,
    stale: row.stale,
    last_success_at: row.last_success_at instanceof Date ? row.last_success_at.toISOString() : row.last_success_at,
    last_failure_at: row.last_failure_at instanceof Date ? row.last_failure_at.toISOString() : row.last_failure_at,
    next_run_at: row.next_run_at instanceof Date ? row.next_run_at.toISOString() : row.next_run_at,
    rows: row.rows_count,
  };
}
