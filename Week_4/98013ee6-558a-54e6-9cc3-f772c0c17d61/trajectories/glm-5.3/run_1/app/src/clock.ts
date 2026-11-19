import { poolDb } from "./db";

/**
 * Business clock (DP-03). Kept in Postgres, starts at MOTHLIGHT_START_AT (or real time),
 * runs in real time, movable by the grading route. Every stored time reads it.
 */
let baseInstant: Date; // business now at the moment baseReal was read
let baseReal: number;  // Date.now() at that moment

export async function initClock(): Promise<void> {
  const row = await poolDb.queryOne<{ value: string }>(`select value from meta where key = 'clock'`);
  if (!row) {
    const startAt = process.env.MOTHLIGHT_START_AT;
    const initial = startAt ? new Date(startAt) : new Date();
    if (Number.isNaN(initial.getTime())) throw new Error("MOTHLIGHT_START_AT is not a valid instant");
    await poolDb.query(
      `insert into meta (key, value) values ('clock', $1) on conflict (key) do nothing`,
      [initial.toISOString()]
    );
  }
  // A server joining a database that already has a clock keeps that stored clock.
  await loadClock();
}

async function loadClock(): Promise<void> {
  const row = await poolDb.queryOne<{ value: string }>(`select value from meta where key = 'clock'`);
  baseInstant = new Date(row!.value);
  baseReal = Date.now();
}

/** The business now, running in real time from the stored instant. */
export function businessNow(): Date {
  return new Date(baseInstant.getTime() + (Date.now() - baseReal));
}

/** Moves the clock to the given instant; it keeps running from there. */
export async function setBusinessNow(iso: string): Promise<Date> {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error("invalid instant");
  await poolDb.query(
    `update meta set value = $1 where key = 'clock'`,
    [at.toISOString()]
  );
  await loadClock();
  return businessNow();
}

/**
 * Other server instances converge on a moved clock by persisting the current
 * business now: the stored instant stays fresh, and joining servers keep it.
 * The stored value is the base, never re-read on the same instance (it would
 * lose the time elapsed since it was stored).
 */
export async function persistClock(): Promise<void> {
  try {
    await poolDb.query(`update meta set value = $1 where key = 'clock'`, [businessNow().toISOString()]);
  } catch { /* keep counting on from the last known value */ }
}
