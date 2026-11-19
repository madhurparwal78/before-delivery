/**
 * Library wall-clock time. Every date and cutoff in Pegworth is decided here,
 * on the library time zone's own calendar, never on a browser's clock.
 */

export type LibraryDate = string;

export interface WallClock {
  readonly date: LibraryDate;
  readonly secondOfDay: number;
}

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:(Z|z)|([+-])(\d{2}):?(\d{2}))$/;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const abbreviationFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

function abbreviationFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = abbreviationFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    abbreviationFormatters.set(zone, formatter);
  }
  return formatter;
}

export function isIanaZone(zone: string): boolean {
  if (zone !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_.+-]+)+$/.test(zone)) return false;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone === zone;
  } catch {
    return false;
  }
}

interface ClockFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function clockFields(instant: Date, zone: string): ClockFields {
  const fields: Record<string, number> = {};
  for (const part of partsFormatter(zone).formatToParts(instant)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 0,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function dateOf(fields: ClockFields): LibraryDate {
  return `${pad(fields.year, 4)}-${pad(fields.month, 2)}-${pad(fields.day, 2)}`;
}

/** Minutes the zone is ahead of UTC at this instant. */
export function offsetMinutesAt(instant: Date, zone: string): number {
  const fields = clockFields(instant, zone);
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export function wallClockAt(instant: Date, zone: string): WallClock {
  const fields = clockFields(instant, zone);
  return {
    date: dateOf(fields),
    secondOfDay: fields.hour * 3600 + fields.minute * 60 + fields.second,
  };
}

export function zoneAbbreviationAt(instant: Date, zone: string): string {
  for (const part of abbreviationFormatter(zone).formatToParts(instant)) {
    if (part.type === 'timeZoneName') return part.value;
  }
  return zone;
}

/**
 * Every instant that reads as this wall-clock time in the zone: none for a time
 * skipped when the clocks go forward, two for the hour that repeats when they
 * go back, otherwise one. Earliest first.
 */
export function instantsForWallClock(date: LibraryDate, secondOfDay: number, zone: string): Date[] {
  const parsed = parseLibraryDate(date);
  if (!parsed) return [];
  const naive = Date.UTC(parsed.year, parsed.month - 1, parsed.day) + secondOfDay * 1000;
  const candidateOffsets = new Set<number>([
    offsetMinutesAt(new Date(naive - 86400000), zone),
    offsetMinutesAt(new Date(naive), zone),
    offsetMinutesAt(new Date(naive + 86400000), zone),
  ]);
  const found: number[] = [];
  for (const offset of candidateOffsets) {
    const instant = naive - offset * 60000;
    const clock = wallClockAt(new Date(instant), zone);
    if (clock.date === date && clock.secondOfDay === secondOfDay && !found.includes(instant)) {
      found.push(instant);
    }
  }
  return found.sort((a, b) => a - b).map((value) => new Date(value));
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
}

/** ISO 8601 carrying the zone's offset in force at that instant. */
export function formatInstant(instant: Date, zone: string): string {
  const fields = clockFields(instant, zone);
  return (
    `${dateOf(fields)}T${pad(fields.hour, 2)}:${pad(fields.minute, 2)}:${pad(fields.second, 2)}` +
    formatOffset(offsetMinutesAt(instant, zone))
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseTimestamp(text: string): Date | null {
  const match = TIMESTAMP_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zulu, sign, offsetHour, offsetMinute] =
    match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second ?? '0');
  if (monthNumber < 1 || monthNumber > 12) return null;
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) return null;
  if (hourNumber > 23 || minuteNumber > 59 || secondNumber > 59) return null;
  let offsetMinutes = 0;
  if (!zulu) {
    const hours = Number(offsetHour);
    const minutes = Number(offsetMinute);
    if (hours > 23 || minutes > 59) return null;
    offsetMinutes = (hours * 60 + minutes) * (sign === '-' ? -1 : 1);
  }
  const milliseconds = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  return new Date(
    Date.UTC(
      Number(year),
      monthNumber - 1,
      dayNumber,
      hourNumber,
      minuteNumber,
      secondNumber,
      milliseconds,
    ) -
      offsetMinutes * 60000,
  );
}

export function parseLibraryDate(
  text: string,
): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Minutes past midnight for an `HH:MM` clock time, or null when it is not one. */
export function parseClockTime(text: string): number | null {
  const match = TIME_PATTERN.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatClockTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
}

export function addDays(date: LibraryDate, days: number): LibraryDate {
  const parsed = parseLibraryDate(date);
  if (!parsed) throw new Error(`Not a library date: ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
    .toISOString()
    .slice(0, 10);
}

export function weekdayOf(date: LibraryDate): Weekday {
  const parsed = parseLibraryDate(date);
  if (!parsed) throw new Error(`Not a library date: ${date}`);
  const index = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return WEEKDAYS[(index + 6) % 7] as Weekday;
}

export function today(zone: string, now: Date): LibraryDate {
  return wallClockAt(now, zone).date;
}
