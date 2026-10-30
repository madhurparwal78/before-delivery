/**
 * Kitchen-time arithmetic. Every conversion between an instant and the
 * kitchen's wall clock goes through this module, so daylight-saving changes
 * are handled in exactly one place.
 */

export const KITCHEN_TIME_ZONE = 'America/Chicago';

export const MINUTES_PER_CELL = 15;
export const BOARD_OPENS_MINUTES = 5 * 60;
export const BOARD_CLOSES_MINUTES = 24 * 60;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatterCache.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      era: 'short',
    });
    formatterCache.set(timeZone, found);
  }
  return found;
}

export function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  // Intl renders midnight as hour 24 in the h23-with-hour12:false combination.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return (asUtc - truncated) / 60000;
}

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/** `YYYY-MM-DD` for the given instant in kitchen time. */
export function kitchenDateOf(instant: Date, timeZone: string): string {
  const wall = wallClockAt(instant, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseDate(date: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isValidDate(date: string): boolean {
  return parseDate(date) !== null;
}

export function formatDate(value: CalendarDate): string {
  return `${pad(value.year, 4)}-${pad(value.month, 2)}-${pad(value.day, 2)}`;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`invalid date: ${date}`);
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return formatDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new Error('invalid date');
  const left = Date.UTC(a.year, a.month - 1, a.day);
  const right = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((right - left) / 86400000);
}

/**
 * The instant at which the kitchen wall clock reads `date` + `minutes`.
 * `minutes` may be 1440, meaning midnight at the end of the date.
 */
export function instantAtKitchen(date: string, minutes: number, timeZone: string): Date {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`invalid date: ${date}`);
  const dayShift = Math.floor(minutes / 1440);
  const withinDay = minutes - dayShift * 1440;
  const naiveUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day + dayShift,
    Math.floor(withinDay / 60),
    withinDay % 60,
  );
  // Two passes resolve the offset at the resulting instant rather than at UTC.
  const firstGuess = naiveUtc - offsetMinutesAt(new Date(naiveUtc), timeZone) * 60000;
  const secondOffset = offsetMinutesAt(new Date(firstGuess), timeZone);
  return new Date(naiveUtc - secondOffset * 60000);
}

/** ISO 8601 to the second carrying the kitchen's UTC offset at that instant. */
export function formatInstant(instant: Date, timeZone: string): string {
  const wall = wallClockAt(instant, timeZone);
  const offset = offsetMinutesAt(instant, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}` +
    `T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}:${pad(wall.second, 2)}` +
    `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`
  );
}

/** `HH:MM` from minutes since kitchen midnight. 1440 renders as `24:00`. */
export function formatClock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
}

export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;
  const total = hour * 60 + minute;
  if (total > 1440) return null;
  return total;
}

/**
 * Parses an ISO 8601 instant that carries an explicit offset or `Z`.
 * Values without an offset are rejected, so a test clock is never ambiguous.
 */
export function parseInstantWithOffset(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Parses a kitchen-local `YYYY-MM-DDTHH:MM` into an instant. */
export function parseKitchenLocalInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = match[1] as string;
  if (!isValidDate(date)) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  return instantAtKitchen(date, hour * 60 + minute, timeZone);
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `Wed 10 Feb 2027`, built from the date alone so no clock is consulted. */
export function formatBoardDate(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  const utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const weekday = WEEKDAY_NAMES[utc.getUTCDay()] as string;
  const month = MONTH_NAMES[parsed.month - 1] as string;
  return `${weekday} ${parsed.day} ${month} ${parsed.year}`;
}

/** `10 Feb`, used on ticket slips. */
export function formatDayMonth(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1] as string}`;
}
