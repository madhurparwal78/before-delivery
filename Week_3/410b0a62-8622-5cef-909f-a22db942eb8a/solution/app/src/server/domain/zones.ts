import { isValidDate } from '../../shared/dates.js';

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let found = formatters.get(tz);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(tz, found);
  }
  return found;
}

interface WallClock {
  date: string;
  time: string;
  /** The wall clock read as if it were UTC, in milliseconds. */
  asUtc: number;
}

function wallClock(instant: number, tz: string): WallClock {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const date = `${parts['year']}-${parts['month']}-${parts['day']}`;
  const time = `${parts['hour']}:${parts['minute']}`;
  const asUtc = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']), Number(parts['second']));
  return { date, time, asUtc };
}

const offsetMs = (instant: number, tz: string): number => wallClock(instant, tz).asUtc - Math.floor(instant / 1000) * 1000;

/**
 * The instant of a local wall-clock time. A time inside a spring-forward gap moves later by the gap's
 * length; a repeated time takes its first, earlier occurrence.
 */
export function localToInstant(date: string, time: string, tz: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const valid: number[] = [];
  for (const probe of [local - DAY_MS, local + DAY_MS]) {
    const offset = offsetMs(probe, tz);
    if (offsetMs(local - offset, tz) === offset) valid.push(local - offset);
  }
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(local - offsetMs(local - DAY_MS, tz));
}

function instantToLocal(instant: Date, tz: string): { date: string; time: string } {
  const { date, time } = wallClock(instant.getTime(), tz);
  return { date, time };
}

export interface SessionStart {
  date: string;
  start_local: string;
  start_utc: Date;
}

const START_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** An ISO-8601 date-time read in the athlete's zone; a text with no offset is taken as that zone's wall clock. */
export function parseStart(text: string, tz: string): SessionStart | null {
  const match = START_PATTERN.exec(text);
  if (!match) return null;
  const [, date, hour, minute, second = '0', offset] = match;
  if (!isValidDate(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset === undefined) {
    const start_local = `${hour}:${minute}`;
    return { date, start_local, start_utc: localToInstant(date, start_local, tz) };
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return null;
  const local = instantToLocal(instant, tz);
  return { date: local.date, start_local: local.time, start_utc: instant };
}

/** Today's date in a zone. */
export const dateInZone = (instant: Date, tz: string): string => instantToLocal(instant, tz).date;
