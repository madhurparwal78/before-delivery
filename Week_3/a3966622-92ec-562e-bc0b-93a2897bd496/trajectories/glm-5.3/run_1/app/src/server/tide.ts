import { portInstant } from './porttime.js';
import { STANDARD_DAY, type TideEvent } from './route.js';

// Tide height comes from cosine interpolation between published events over
// real elapsed time, with each waypoint's published time and height offset.

export interface TideTimeline {
  date: string;
  version: number;
  events: readonly TideEvent[];
}

interface Knot {
  ms: number;
  height_mm: number;
}

// Build the interpolation knots for a date: the date's own events, plus the
// previous date's last event and the next date's first, so interpolation
// crosses midnight.
export function tideKnots(
  date: string,
  eventsFor: (date: string) => readonly TideEvent[],
): Knot[] {
  const prevDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const prev = eventsFor(prevDate);
  const cur = eventsFor(date);
  const next = eventsFor(nextDate);
  const knots: Knot[] = [];
  const push = (day: string, ev: TideEvent) => {
    const ms = portInstant(day, ev.at);
    if (ms !== null) knots.push({ ms, height_mm: ev.height_mm });
  };
  if (prev.length > 0) push(prevDate, prev[prev.length - 1]!);
  for (const ev of cur) push(date, ev);
  if (next.length > 0) push(nextDate, next[0]!);
  knots.sort((a, b) => a.ms - b.ms);
  return knots;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d! + days);
  return new Date(ms).toISOString().slice(0, 10);
}

// Height at an instant between consecutive events by the published cosine rule.
export function tideHeightAt(knots: readonly Knot[], ms: number): number | null {
  if (knots.length === 0) return null;
  if (ms <= knots[0]!.ms) return knots[0]!.height_mm;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    if (ms >= a.ms && ms <= b.ms) {
      const span = b.ms - a.ms;
      const along = ms - a.ms;
      return a.height_mm + (b.height_mm - a.height_mm) * (1 - Math.cos(Math.PI * (along / span))) / 2;
    }
  }
  return knots[knots.length - 1]!.height_mm;
}

// A waypoint's tide is the height at (arrival minus the waypoint's time
// offset) plus its height offset.
export function waypointTideMm(
  knots: readonly Knot[],
  arrivalMs: number,
  timeOffsetMinutes: number,
  heightOffsetMm: number,
): number {
  const raw = tideHeightAt(knots, arrivalMs - timeOffsetMinutes * 60_000);
  return (raw ?? 0) + heightOffsetMm;
}

export function standardEvents(date: string): readonly TideEvent[] {
  // The standard day repeats for every date without a revision.
  void date;
  return STANDARD_DAY;
}
