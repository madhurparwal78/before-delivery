/**
 * The library calendar: the one place that decides open days, closing instants and
 * the local formats. Every local date and time goes through the configured IANA zone.
 */

export type LocalDate = string;

export interface LibraryCalendar {
  readonly timeZone: string;
  /** Lower-case three-letter weekday keys, as seeded. */
  readonly openDays: readonly string[];
  readonly closedDates: readonly LocalDate[];
  readonly openingTime: string;
  readonly closingTime: string;
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(instant: Date, timeZone: string): WallParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return Number(found ? found.value : 0);
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

/** The zone's offset from UTC, in milliseconds, at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = wallParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    instant.getUTCMilliseconds(),
  );
  return asIfUtc - instant.getTime();
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const asUtc = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(asUtc)) return false;
  return new Date(asUtc).toISOString().slice(0, 10) === value;
}

/** Local dates are compared and shifted as plain calendar dates, free of any offset. */
function dateToDayNumber(date: LocalDate): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dayNumberToDate(day: number): LocalDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return dayNumberToDate(dateToDayNumber(date) + days);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return dateToDayNumber(to) - dateToDayNumber(from);
}

export function weekdayKey(date: LocalDate): string {
  const index = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEKDAY_KEYS[index] as string;
}

export function today(calendar: LibraryCalendar, now: Date): LocalDate {
  return localDateOf(calendar, now);
}

export function localDateOf(calendar: LibraryCalendar, instant: Date): LocalDate {
  const parts = wallParts(instant, calendar.timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** An open day is a date whose weekday is open and which is not a closure date. */
export function isOpenDay(calendar: LibraryCalendar, date: LocalDate): boolean {
  if (!calendar.openDays.includes(weekdayKey(date))) return false;
  return !calendar.closedDates.includes(date);
}

/** The instant a wall-clock time falls on, using the offset in force on that date itself. */
export function instantAt(calendar: LibraryCalendar, date: LocalDate, time: string): Date {
  const naive = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  let guess = naive - zoneOffsetMs(new Date(naive), calendar.timeZone);
  guess = naive - zoneOffsetMs(new Date(guess), calendar.timeZone);
  return new Date(guess);
}

/** The closing instant of a date: that date's closing time, at that date's own offset. */
export function closingInstant(calendar: LibraryCalendar, date: LocalDate): Date {
  return instantAt(calendar, date, calendar.closingTime);
}

/** The first open day strictly after the given date. */
export function nextOpenDay(calendar: LibraryCalendar, date: LocalDate): LocalDate {
  let candidate = addDays(date, 1);
  for (let step = 0; step < 400; step += 1) {
    if (isOpenDay(calendar, candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function localTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    timeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** `<local time>`, for example `Sun 1 Nov 2026, 18:00 EST`. */
export function formatLocalTime(calendar: LibraryCalendar, instant: Date): string {
  const parts = localTimeFormatter(calendar.timeZone).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : '';
  };
  const weekday = pick('weekday');
  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  const hour = pick('hour');
  const minute = pick('minute');
  const zone = pick('timeZoneName');
  return `${weekday} ${day} ${month} ${year}, ${hour}:${minute} ${zone}`;
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** A short local date, for the lane summary lines: `Sun 1 Nov`. */
export function formatLocalDate(calendar: LibraryCalendar, date: LocalDate): string {
  let formatter = dateFormatterCache.get(calendar.timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    dateFormatterCache.set(calendar.timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(`${date}T00:00:00Z`));
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : '';
  };
  return `${pick('weekday')} ${pick('day')} ${pick('month')}`;
}
