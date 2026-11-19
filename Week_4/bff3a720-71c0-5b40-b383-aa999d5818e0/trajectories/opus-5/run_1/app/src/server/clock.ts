import { db, type Queryable } from './db.js';

let offsetSeconds = 0;

export async function loadClockOffset(tx: Queryable = db): Promise<number> {
  const { rows } = await tx.query<{ offset_seconds: number }>(
    'select offset_seconds from clock_offset where id = 1',
  );
  offsetSeconds = rows[0] ? Number(rows[0].offset_seconds) : 0;
  return offsetSeconds;
}

/** The one server clock: wall time plus the shared grading offset. */
export function now(): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

export async function advanceClock(seconds: number): Promise<Date> {
  const { rows } = await db.query<{ offset_seconds: number }>(
    'update clock_offset set offset_seconds = offset_seconds + $1 where id = 1 returning offset_seconds',
    [seconds],
  );
  offsetSeconds = rows[0] ? Number(rows[0].offset_seconds) : offsetSeconds;
  return now();
}
