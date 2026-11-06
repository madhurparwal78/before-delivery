import { istTimestamp } from "../../shared/format.js";

// The business clock and IST arithmetic. IST has no daylight saving, so it is UTC + 05:30 everywhere.

const IST_OFFSET_MS = 5.5 * 3600_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export interface BusinessClock {
  /** Business time now, as epoch milliseconds. */
  now(): number;
  rate: number;
}

/** Reads the real time, or, with a start instant, advances `rate` business seconds per real second from server start. */
export function createClock(start: string | undefined, rate: number): BusinessClock {
  if (!start) return { now: () => Date.now(), rate: 1 };
  const origin = Date.parse(start);
  if (Number.isNaN(origin)) throw new Error("RAIL_CLOCK_START must be an ISO 8601 timestamp");
  const startedAt = performance.now();
  return { now: () => origin + Math.floor((performance.now() - startedAt) * rate), rate };
}

export { istTimestamp };

/** The IST calendar date of an instant, `YYYY-MM-DD`. */
function istDate(ms: number): string {
  return istTimestamp(ms).slice(0, 10);
}

/** The instant `minutes` after 00:00 IST on `date` (minutes may run past one day). */
export function istInstant(date: string, minutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - IST_OFFSET_MS + minutes * MINUTE_MS;
}

export function addDays(date: string, days: number): string {
  return istDate(istInstant(date, 0) + days * DAY_MS);
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return istDate(istInstant(value, 0)) === value;
}
