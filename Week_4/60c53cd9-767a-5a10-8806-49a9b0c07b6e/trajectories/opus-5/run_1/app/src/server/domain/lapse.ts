/**
 * The one lapse check. Every read and every write that touches a hold or its
 * unit runs it first: at or after `endsAt` the hold becomes lapsed with
 * `endedAt = endsAt`, its unit becomes available and an index update is queued.
 */

import { query, type Db } from '../db';
import { now } from '../clock';

/** Returns the units this check freed, so callers can wait for the index. */
export async function applyLapseCheck(db: Db): Promise<string[]> {
  const rows = await query<{ unit_code: string }>(
    db,
    `with lapsed as (
        update holds set status = 'lapsed', ended_by = 'lapse', ended_at = ends_at
         where status = 'active' and ends_at <= $1
         returning unit_code
      ), freed as (
        update units set status = 'available'
         where code in (select unit_code from lapsed) and status = 'held'
         returning code
      )
      insert into pending_index_updates (unit_code, operation, queued_at)
      select code, 'upsert', $1 from freed
      returning unit_code`,
    [now()],
  );
  return rows.map((row) => row.unit_code);
}
