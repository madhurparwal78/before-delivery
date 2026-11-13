import type { Weekday } from '../shared/types.js';

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_MS = 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  const found = formatters.get(zone);
  if (found) return found;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(zone, made);
  return made;
}

export function isValidTimeZone(zone: string): boolean {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallParts(instant: number, zone: string): WallParts {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part ? part.value : 0);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

/** The local wall clock reading of an instant, expressed as a UTC timestamp. */
function wallClock(instant: number, zone: string): number {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part ? part.value : 0);
  };
  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
}

export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return { year, month, day };
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseLocalDate(value);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return toDateString(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

function toDateString(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function weekdayOf(date: string): Weekday {
  const { year, month, day } = parseLocalDate(date);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[(index + 6) % 7] as Weekday;
}

/**
 * The first instant the zone's local clock reads `hour`:00 on `date`.
 * A hour swallowed by a spring-forward gap resolves to the first instant after
 * the gap; an hour repeated by a fall-back resolves to its first occurrence.
 */
export function dayStartInstant(date: string, hour: number, zone: string): number {
  const { year, month, day } = parseLocalDate(date);
  const targetWall = Date.UTC(year, month - 1, day, hour);

  const first = targetWall - (wallClock(targetWall, zone) - targetWall);
  const second = targetWall - (wallClock(first, zone) - first);
  const candidates = [...new Set([first, second])]
    .filter((candidate) => wallClock(candidate, zone) === targetWall)
    .sort((a, b) => a - b);
  const earliest = candidates[0];
  if (earliest !== undefined) return earliest;

  let low = targetWall - 36 * HOUR_MS;
  for (let high = low + HOUR_MS; high <= targetWall + 36 * HOUR_MS; high += HOUR_MS) {
    if (wallClock(low, zone) < targetWall && wallClock(high, zone) >= targetWall) {
      let lower = low;
      let upper = high;
      while (upper - lower > 1000) {
        const middle = lower + Math.floor((upper - lower) / 2000) * 1000;
        if (wallClock(middle, zone) >= targetWall) upper = middle;
        else lower = middle;
      }
      return upper;
    }
    low = high;
  }
  return targetWall;
}

/** The local date whose day, by the day rule, contains `instant`. */
export function localDateOf(instant: number, hour: number, zone: string): string {
  const parts = wallParts(instant, zone);
  const calendarDate = toDateString(parts.year, parts.month, parts.day);
  if (instant < dayStartInstant(calendarDate, hour, zone)) return addDays(calendarDate, -1);
  return calendarDate;
}

/** The text `<weekday> <HH:MM> (<zone>)` for an instant in a zone. */
export function dayStartText(instant: number, zone: string): string {
  const parts = wallParts(instant, zone);
  const date = toDateString(parts.year, parts.month, parts.day);
  const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return `${weekdayOf(date)} ${time} (${zone})`;
}

export { WEEKDAYS };
