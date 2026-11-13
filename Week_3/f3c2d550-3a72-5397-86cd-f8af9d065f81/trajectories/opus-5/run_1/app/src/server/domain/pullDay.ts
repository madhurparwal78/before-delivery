import { addDays, localDate, localTimeOnDate, wallClockAt } from './zones.js';

/** The hour at which a pull day turns over, local in the effective home zone. */
export const PULL_HOUR = 6;

/**
 * The pull day for an instant is the local date in the effective home zone, minus one day
 * when the local time is before 06:00:00. At 06:00:00 exactly the new day has begun.
 */
export function pullDayFor(zone: string, instantMs: number): string {
  const wall = wallClockAt(zone, instantMs);
  const date = localDate(zone, instantMs);
  return wall.hour < PULL_HOUR ? addDays(date, -1) : date;
}

/** The next 06:00:00 local in the zone, strictly after the instant. */
export function nextPullAt(zone: string, instantMs: number): number {
  const today = localDate(zone, instantMs);
  const candidate = localTimeOnDate(zone, today, PULL_HOUR);
  if (candidate > instantMs) return candidate;
  return localTimeOnDate(zone, addDays(today, 1), PULL_HOUR);
}

/** How many pull days back are excluded from a new pick. */
export const PULL_HISTORY_SPAN = 30;
