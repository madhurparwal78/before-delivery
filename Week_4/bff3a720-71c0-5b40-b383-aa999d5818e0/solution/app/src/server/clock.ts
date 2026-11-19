import type { Db } from "./db";

let offsetMs = 0;

/** The one server clock: wall time plus the grading offset stored in PostgreSQL. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

/** Real wall time without the grading offset, for protocols that check it (request signatures, mail headers). */
export function wallClock(): Date {
  return new Date();
}

/** Read the shared offset; called at the start of every request and job so instances agree. */
export async function syncClock(db: Db): Promise<void> {
  const { rows } = await db.query<{ offset_seconds: number }>("SELECT offset_seconds FROM clock_offset WHERE id = 1");
  offsetMs = (rows[0]?.offset_seconds ?? 0) * 1000;
}

/** Move the clock forward by whole seconds; the offset never goes backwards. */
export async function advanceClock(db: Db, seconds: number): Promise<void> {
  await db.query("UPDATE clock_offset SET offset_seconds = offset_seconds + $1 WHERE id = 1", [seconds]);
  await syncClock(db);
}

export function plusSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

export function plusMinutes(at: Date, minutes: number): Date {
  return plusSeconds(at, minutes * 60);
}
