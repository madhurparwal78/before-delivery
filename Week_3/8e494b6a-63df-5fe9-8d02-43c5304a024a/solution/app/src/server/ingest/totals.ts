// The ingest line of the status bar: events stored and failures kept in a space.
import { pool, type Queryable } from "../db";

export async function ingestTotals(spaceId: number, db: Queryable = pool): Promise<{ stored_total: number; failure_total: number }> {
  const { rows } = await db.query<{ stored: number; failed: number }>(
    `SELECT (SELECT count(*) FROM event_keys k JOIN streams s ON s.id = k.stream_id WHERE s.space_id = $1) AS stored,
            (SELECT count(*) FROM failures f JOIN streams s ON s.id = f.stream_id WHERE s.space_id = $1) AS failed`,
    [spaceId],
  );
  const row = rows[0] as { stored: number; failed: number };
  return { stored_total: row.stored, failure_total: row.failed };
}
