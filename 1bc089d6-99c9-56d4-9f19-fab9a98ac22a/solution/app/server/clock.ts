import { config } from "./config";
import { withDb } from "./db";

// The app clock: real time, unless STILLHOUR_TEST_CLOCK=1 and an instant has been set through the API.
// The set instant stays frozen until it is changed or cleared. It lives in the database, so every
// instance sharing it follows within a second.

const KEY = "clock";
const REFRESH_MS = 400;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

let frozen: number | null = null;
/** Bumped by every local set or clear, so a refresh that read the database before it cannot undo it. */
let generation = 0;

/**
 * A SQL condition true only while no test instant is stored, read in the statement's own snapshot. Work
 * that forgets old rows by real time checks it there, because a test clock moved back makes rows written
 * "now" look old to an instance that has not seen the move yet.
 */
export const CLOCK_IS_REAL = `NOT EXISTS (SELECT 1 FROM settings WHERE key = '${KEY}')`;

export function now(): Date {
  return new Date(frozen ?? Date.now());
}

/** An ISO 8601 date and time that names its offset (Z or ±HH:MM), as an instant; null otherwise. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_ZONE.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

async function refresh() {
  const started = generation;
  const row = await withDb((db) => db.query<{ value: { now: number } }>("SELECT value FROM settings WHERE key = $1", [KEY]));
  if (started === generation) frozen = row.rows[0]?.value.now ?? null;
}

export async function setTestClock(instant: Date) {
  await withDb((db) =>
    db.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [KEY, JSON.stringify({ now: instant.getTime() })],
    ),
  );
  generation += 1;
  frozen = instant.getTime();
}

export async function clearTestClock() {
  await withDb((db) => db.query("DELETE FROM settings WHERE key = $1", [KEY]));
  generation += 1;
  frozen = null;
}

export function startClockSync() {
  if (!config.testClock) return () => {};
  const timer = setInterval(() => {
    refresh().catch(() => {});
  }, REFRESH_MS);
  refresh().catch(() => {});
  return () => clearInterval(timer);
}
