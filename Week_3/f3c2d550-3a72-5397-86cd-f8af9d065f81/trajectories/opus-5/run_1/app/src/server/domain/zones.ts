import { ZONE_NAMES, isAcceptedZone } from '../../shared/zoneNames.js';

export { ZONE_NAMES, isAcceptedZone };

/**
 * The single place where a local time in a home zone is turned into an instant and back.
 *
 * Every local time uses the zone's own offset at that local moment. A local time that does
 * not exist means the first instant after the gap; one that occurs twice means the earlier
 * occurrence.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;

/**
 * `America/Coyhaique` entered the IANA database after the ICU build bundled with the
 * runtime, so its offsets are read from a zone that keeps the same rules (-03, no DST).
 */
const ICU_SUBSTITUTE: Record<string, string> = {
  'America/Coyhaique': 'America/Argentina/Buenos_Aires',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ICU_SUBSTITUTE[zone] ?? zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function wallClockAt(zone: string, instantMs: number): WallClock {
  const parts = formatterFor(zone).formatToParts(instantMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export function offsetMinutesAt(zone: string, instantMs: number): number {
  const wall = wallClockAt(zone, instantMs);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return Math.round((asIfUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

function sameWall(zone: string, instantMs: number, wanted: WallClock): boolean {
  const wall = wallClockAt(zone, instantMs);
  return (
    wall.year === wanted.year &&
    wall.month === wanted.month &&
    wall.day === wanted.day &&
    wall.hour === wanted.hour &&
    wall.minute === wanted.minute &&
    wall.second === wanted.second
  );
}

/** The instant at which the offset changes inside `(low, high]`. */
function transitionInstant(zone: string, low: number, high: number): number {
  const startOffset = offsetMinutesAt(zone, low);
  let lo = low;
  let hi = high;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutesAt(zone, mid) === startOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function localToInstant(zone: string, wall: WallClock): number {
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const before = offsetMinutesAt(zone, asIfUtc - DAY_MS);
  const after = offsetMinutesAt(zone, asIfUtc + DAY_MS);
  const offsets = before === after ? [before] : [before, after];
  const valid = offsets
    .map((offset) => asIfUtc - offset * 60_000)
    .filter((instant) => sameWall(zone, instant, wall))
    .sort((a, b) => a - b);
  const earliest = valid[0];
  if (earliest !== undefined) return earliest;
  return transitionInstant(zone, asIfUtc - DAY_MS, asIfUtc + DAY_MS);
}

export function localDate(zone: string, instantMs: number): string {
  const wall = wallClockAt(zone, instantMs);
  return isoDate(wall.year, wall.month, wall.day);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The instant of a local time of day on a local date in a zone. */
export function localTimeOnDate(
  zone: string,
  date: string,
  hour: number,
  minute = 0,
  second = 0,
): number {
  const { year, month, day } = parseIsoDate(date);
  return localToInstant(zone, { year, month, day, hour, minute, second });
}

/** The start of the local date that contains `instantMs`. */
export function startOfLocalDay(zone: string, instantMs: number): number {
  return localTimeOnDate(zone, localDate(zone, instantMs), 0);
}

/** The first local midnight in `zone` strictly after `instantMs`. */
export function nextLocalMidnight(zone: string, instantMs: number): number {
  const today = startOfLocalDay(zone, instantMs);
  if (today > instantMs) return today;
  return localTimeOnDate(zone, addDays(localDate(zone, instantMs), 1), 0);
}

export function currentYearIn(zone: string, instantMs: number): number {
  return wallClockAt(zone, instantMs).year;
}
