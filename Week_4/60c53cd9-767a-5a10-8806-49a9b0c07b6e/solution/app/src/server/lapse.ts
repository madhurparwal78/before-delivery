/** The lapse check: the one place an active hold past its end becomes lapsed. Every hold read and write calls it first. */
import type { Queryable } from "./db.js";

/**
 * Lapses every active hold whose end time has been reached by the app clock: the hold becomes `lapsed` with
 * `endedAt = endsAt`, its share link dies, and an index update is queued for its unit. Returns the units freed.
 */
export const lapseExpired = async (db: Queryable, now: Date): Promise<string[]> => {
  const result = await db.query<{ unit_code: string }>(
    `WITH lapsed AS (
       UPDATE holds
          SET status = 'lapsed', ended_by = 'lapse', ended_at = ends_at, share_token = NULL
        WHERE status = 'active' AND ends_at <= $1
        RETURNING unit_code)
     INSERT INTO index_updates (unit_code, created_at)
     SELECT unit_code, $1 FROM lapsed
     RETURNING unit_code`,
    [now],
  );
  return result.rows.map((row) => row.unit_code);
};
