// Dates and wall-clock time in the named towns. Never reads the device's language, zone or clock.

export type Town = 'amsterdam' | 'newYork' | 'toronto' | 'dubai';

export const TOWN_NAMES: Record<Town, string> = {
  amsterdam: 'Amsterdam',
  newYork: 'New York',
  toronto: 'Toronto',
  dubai: 'Dubai',
};

export const TOWN_ZONES: Record<Town, string> = {
  amsterdam: 'Europe/Amsterdam',
  newYork: 'America/New_York',
  toronto: 'America/Toronto',
  dubai: 'Asia/Dubai',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, found);
  }
  return found;
}

function wallParts(instant: number, zone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) parts[part.type] = part.value;
  return parts;
}

/** Local minus UTC, in milliseconds, at an instant. */
function offsetAt(instant: number, zone: string): number {
  const p = wallParts(instant, zone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - (instant - (instant % 1000));
}

/** `2027-03-15` on the local date of a zone. */
export function dateIn(instant: number, zone: string): string {
  const p = wallParts(instant, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `09:00` on the local clock of a zone. */
export function clockIn(instant: number, zone: string): string {
  const p = wallParts(instant, zone);
  return `${p.hour}:${p.minute}`;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(dayNumber(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return (dayNumber(to) - dayNumber(from)) / DAY_MS;
}

/** 0 is Sunday. */
export function weekdayOf(date: string): number {
  return new Date(dayNumber(date)).getUTCDay();
}

export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** `Mon 29 Mar 2027` */
export function printDate(date: string): string {
  const at = new Date(dayNumber(date));
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * The instant of a wall time in a zone: null for a time the clock change skips, the first of the
 * two for a time that happens twice.
 */
export function wallToInstant(date: string, clock: string, zone: string): number | null {
  const [h, m] = clock.split(':').map(Number) as [number, number];
  const wall = dayNumber(date) + (h * 60 + m) * 60_000;
  const candidates = [offsetAt(wall - DAY_MS, zone), offsetAt(wall + DAY_MS, zone)]
    .map((offset) => ({ offset, instant: wall - offset }))
    .filter(({ offset, instant }) => offsetAt(instant, zone) === offset)
    .map(({ instant }) => instant);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Whole-second UTC instant with a Z. */
export function instantText(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d+Z$/, 'Z');
}

/** A time after which a person may try again prints the next whole minute. */
export function clockRoundedUp(instant: number, zone: string): string {
  return clockIn(Math.ceil(instant / 60_000) * 60_000, zone);
}

/** `Mon 29 Mar 2027, 09:00 Amsterdam time` */
export function printDateTime(instant: number, town: Town): string {
  const zone = TOWN_ZONES[town];
  return `${printDate(dateIn(instant, zone))}, ${clockIn(instant, zone)} ${TOWN_NAMES[town]} time`;
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  return new Date(dayNumber(value)).toISOString().slice(0, 10) === value;
}

export function isRealClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The next dates a zone's clock changes after a date, within a year: the date the new offset first shows at noon. */
export function nextClockChange(start: string, zone: string): string {
  let previous = start;
  for (let n = 0; n < 400; n += 1) {
    const current = addDays(previous, 1);
    if (offsetAt(dayNumber(previous) + 43_200_000, zone) !== offsetAt(dayNumber(current) + 43_200_000, zone)) return current;
    previous = current;
  }
  return previous;
}
