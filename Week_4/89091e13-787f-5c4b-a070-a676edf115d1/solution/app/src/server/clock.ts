import { config } from "./config.ts";
import { maybeOne, run, type Db } from "./db.ts";

/** The server clock. Everything time-dependent reads it; the device clock never matters. */
let processed = config.startAt;
let wallAtProcessed = Date.now();

export async function loadClock(db: Db): Promise<boolean> {
  const row = await maybeOne<{ instant: Date }>(db, "SELECT instant FROM clock WHERE id = 1");
  if (!row) return false;
  processed = row.instant;
  wallAtProcessed = Date.now();
  return true;
}

/** Real time advances the clock only in realtime mode. */
export function clockNow(): Date {
  return config.clockMode === "realtime" ? new Date(processed.getTime() + (Date.now() - wallAtProcessed)) : processed;
}

export function eventsProcessedThrough(): Date {
  return processed;
}

/** Moves the clock in memory; the database copy is written by `persistClock`. */
export function setProcessed(instant: Date): void {
  processed = instant;
  wallAtProcessed = Date.now();
}

export async function persistClock(db: Db): Promise<void> {
  await run(db, "INSERT INTO clock (id, instant) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET instant = $1", [processed]);
}
