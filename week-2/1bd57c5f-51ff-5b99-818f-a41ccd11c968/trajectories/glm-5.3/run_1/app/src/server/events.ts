import type { PoolClient } from "pg";
import type { Db } from "./db/schema.js";
import { config } from "./config.js";

export type EventType = "item" | "item_deleted" | "room" | "counts" | "note" | "plan" | "visit" | "visit_deleted" | "costs" | "job" | "role_ended";

/** Emits events inside the caller's transaction. Payloads are stored raw; each
 *  open stream projects them for its receiver at delivery time. */
export class EventLog {
  constructor(private readonly client: PoolClient) {}

  async emit(jobId: string, type: EventType, payload: Record<string, unknown>): Promise<void> {
    const next = await this.client.query<{ seq: number }>(
      `UPDATE jobs SET next_event_seq = COALESCE(next_event_seq, 0) + 1 WHERE id = $1 RETURNING next_event_seq AS seq`,
      [jobId],
    );
    const seq = next.rows[0]?.seq;
    if (seq === undefined) return;
    await this.client.query(
      `INSERT INTO events (job_id, seq, type, payload) VALUES ($1, $2, $3, $4)`,
      [jobId, seq, type, JSON.stringify(payload)],
    );
    // Retention: keep the last EVENT_RETENTION_COUNT events per job.
    await this.client.query(
      `DELETE FROM events WHERE job_id = $1 AND seq <= $2::integer - $3::integer`,
      [jobId, seq, config.eventRetentionCount],
    );
  }
}

export type EventRow = { seq: number; type: string; payload: unknown };

export async function readEvents(db: Db, jobId: string, afterSeq: number, limit: number): Promise<EventRow[]> {
  const res = await db.query<EventRow>(
    `SELECT seq, type, payload FROM events WHERE job_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [jobId, afterSeq, limit],
  );
  return res.rows;
}

export async function latestSeq(db: Db, jobId: string): Promise<number> {
  const res = await db.query<{ max: number | null }>(`SELECT max(seq) AS max FROM events WHERE job_id = $1`, [jobId]);
  return res.rows[0]?.max ?? 0;
}

export async function oldestKeptSeq(db: Db, jobId: string): Promise<number> {
  const res = await db.query<{ min: number | null }>(`SELECT min(seq) AS min FROM events WHERE job_id = $1`, [jobId]);
  return res.rows[0]?.min ?? 0;
}
