/**
 * Site-local wall-clock arithmetic in IANA time zones, used by the server for every
 * verdict and by the browser only to show site-local times.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
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

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(zone: string, instantMs: number): LocalParts {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const pick = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** The zone's UTC offset, in milliseconds, at an instant. */
export function zoneOffsetMs(zone: string, instantMs: number): number {
  const parts = localParts(zone, instantMs);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** The site-local calendar date of an instant, as YYYY-MM-DD. */
export function localDateOf(zone: string, instantMs: number): string {
  const parts = localParts(zone, instantMs);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** The site-local wall time of an instant, as HH:MM. */
export function localTimeOf(zone: string, instantMs: number): string {
  const parts = localParts(zone, instantMs);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** The site-local wall time of an instant, as YYYY-MM-DDTHH:MM:SS. */
export function localNowOf(zone: string, instantMs: number): string {
  const parts = localParts(zone, instantMs);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(
    parts.minute,
  )}:${pad2(parts.second)}`;
}

/** Minutes from midnight of a site-local date, as HH:MM (24:00 for the day's end). */
export function minutesToWall(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function wallToMinutes(wall: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(wall);
  if (match === null) return null;
  const hour = Number.parseInt(match[1] as string, 10);
  const minute = Number.parseInt(match[2] as string, 10);
  if (minute > 59) return null;
  const minutes = hour * 60 + minute;
  if (minutes > 24 * 60) return null;
  return minutes;
}

export function parseDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isDate(date: string): boolean {
  return parseDate(date) !== null;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (parsed === null) throw new Error(`Not a calendar date: ${date}`);
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
}

/** Whole days from the first date to the second. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) throw new Error('Not a calendar date');
  const aMs = Date.UTC(a.year, a.month - 1, a.day);
  const bMs = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bMs - aMs) / 86400000);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function weekdayName(date: string): string {
  const parsed = parseDate(date);
  if (parsed === null) throw new Error(`Not a calendar date: ${date}`);
  const index = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return WEEKDAYS[index] as string;
}

export function weekdayIndex(date: string): number {
  const parsed = parseDate(date);
  if (parsed === null) throw new Error(`Not a calendar date: ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/**
 * The instant of a site-local wall time. A local time that does not exist moves forward
 * by the length of the jump; a local time that happens twice means its first occurrence.
 * Minutes may be 1440, meaning the following midnight.
 */
export function localToInstant(zone: string, date: string, minutes: number): number {
  const parsed = parseDate(date);
  if (parsed === null) throw new Error(`Not a calendar date: ${date}`);
  const target =
    Date.UTC(parsed.year, parsed.month - 1, parsed.day) + minutes * 60000;
  const offsetBefore = zoneOffsetMs(zone, target - 86400000);
  const offsetAfter = zoneOffsetMs(zone, target + 86400000);
  const candidates = [target - offsetBefore, target - offsetAfter];
  const valid = candidates.filter((candidate) => zoneOffsetMs(zone, candidate) === target - candidate);
  if (valid.length === 0) return target - offsetBefore;
  return Math.min(...valid);
}

/** Whether a site-local wall time exists on its date. */
export function localTimeExists(zone: string, date: string, minutes: number): boolean {
  const parsed = parseDate(date);
  if (parsed === null) return false;
  const target = Date.UTC(parsed.year, parsed.month - 1, parsed.day) + minutes * 60000;
  const offsetBefore = zoneOffsetMs(zone, target - 86400000);
  const offsetAfter = zoneOffsetMs(zone, target + 86400000);
  return [target - offsetBefore, target - offsetAfter].some(
    (candidate) => zoneOffsetMs(zone, candidate) === target - candidate,
  );
}

/**
 * The stretch of a site-local date whose wall times do not exist, as minutes from
 * midnight, or null when every local time on the date exists.
 */
export function nonexistentRange(
  zone: string,
  date: string,
): { startMinutes: number; endMinutes: number } | null {
  let startMinutes: number | null = null;
  let endMinutes = 0;
  for (let minutes = 0; minutes < 1440; minutes += 15) {
    if (!localTimeExists(zone, date, minutes)) {
      if (startMinutes === null) startMinutes = minutes;
      endMinutes = minutes + 15;
    }
  }
  if (startMinutes === null) return null;
  return { startMinutes, endMinutes };
}
