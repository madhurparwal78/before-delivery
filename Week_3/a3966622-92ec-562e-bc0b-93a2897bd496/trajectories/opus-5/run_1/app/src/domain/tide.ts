import {
  type Wall,
  dateKeyOf,
  instantToWall,
  parsePortTime,
  shiftDate,
  wallToInstant,
} from './porttime.ts';
import { roundHalfUp } from './numerals.ts';
import type { Waypoint } from './route.ts';

export type TideEvent = { at: string; type: 'high' | 'low'; height_mm: number };

/** Published events for a port-local date key, falling back to the seeded standard day. */
export type TideTable = (dateKey: string) => readonly TideEvent[];

export const STANDARD_DAY: readonly TideEvent[] = [
  { at: '00:45', type: 'low', height_mm: 1600 },
  { at: '06:55', type: 'high', height_mm: 9600 },
  { at: '13:05', type: 'low', height_mm: 1400 },
  { at: '19:15', type: 'high', height_mm: 9400 },
];

export function tideTableFrom(revisions: ReadonlyMap<string, readonly TideEvent[]>): TideTable {
  return (dateKey) => revisions.get(dateKey) ?? STANDARD_DAY;
}

type PlacedEvent = { instant: number; height_mm: number };

function placeEvents(date: Wall, events: readonly TideEvent[]): PlacedEvent[] {
  const placed: PlacedEvent[] = [];
  for (const event of events) {
    const time = parsePortTime(event.at);
    if (!time) continue;
    const instant = wallToInstant({
      year: date.year,
      month: date.month,
      day: date.day,
      hour: time.hour,
      minute: time.minute,
      second: 0,
    });
    if (instant !== null) placed.push({ instant, height_mm: event.height_mm });
  }
  return placed;
}

/** Interpolation crosses midnight into the neighbouring date's first or last event. */
function bracketing(table: TideTable, instant: number): [PlacedEvent, PlacedEvent] {
  const date = instantToWall(instant);
  const placed: PlacedEvent[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = shiftDate(date, dayOffset);
    placed.push(...placeEvents(day, table(dateKeyOf(day))));
  }
  placed.sort((left, right) => left.instant - right.instant);
  for (let index = 0; index < placed.length - 1; index += 1) {
    const first = placed[index] as PlacedEvent;
    const second = placed[index + 1] as PlacedEvent;
    if (instant >= first.instant && instant <= second.instant) return [first, second];
  }
  throw new Error(`no tide events bracket instant ${new Date(instant).toISOString()}`);
}

/** Cosine interpolation between consecutive published waters over real elapsed time. */
export function tideHeightAt(table: TideTable, instant: number): number {
  const [first, second] = bracketing(table, instant);
  const ratio = (instant - first.instant) / (second.instant - first.instant);
  return (
    first.height_mm + ((second.height_mm - first.height_mm) * (1 - Math.cos(Math.PI * ratio))) / 2
  );
}

/** A waypoint's tide is the height at its arrival minus its time offset, plus its height offset. */
export function tideAtWaypoint(table: TideTable, waypoint: Waypoint, arrival: number): number {
  const shifted = arrival - waypoint.time_offset_minutes * 60_000;
  return roundHalfUp(tideHeightAt(table, shifted) + waypoint.height_offset_mm);
}

export function eventsAlternate(events: readonly TideEvent[]): boolean {
  for (let index = 1; index < events.length; index += 1) {
    if ((events[index] as TideEvent).type === (events[index - 1] as TideEvent).type) return false;
  }
  return true;
}
