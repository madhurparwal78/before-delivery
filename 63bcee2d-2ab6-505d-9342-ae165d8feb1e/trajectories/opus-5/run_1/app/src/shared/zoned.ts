/** Wall-clock arithmetic in a named time zone, with no floating-point dates. */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partFormatters.set(zone, formatter);
  }
  return formatter;
}

export function wallClockOf(instant: Date, zone: string): WallClock {
  const parts = partFormatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return Number(found ? found.value : '0');
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

function zoneOffsetMs(instant: Date, zone: string): number {
  const wall = wallClockOf(instant, zone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    instant.getUTCMilliseconds(),
  );
  return asUtc - instant.getTime();
}

/** The instant at which the given wall clock reading occurs in the zone. */
export function instantOfWallClock(wall: WallClock, zone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    0,
  );
  let guess = new Date(naive);
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = zoneOffsetMs(guess, zone);
    const next = new Date(naive - offset);
    if (next.getTime() === guess.getTime()) return next;
    guess = next;
  }
  return guess;
}

/** The calendar date in the zone, as YYYY-MM-DD. */
export function dateInZone(instant: Date, zone: string): string {
  const wall = wallClockOf(instant, zone);
    return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseCalendarDate(text: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatCalendarDate(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day of the week for a calendar date: 0 Sunday to 6 Saturday. */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Adds whole months, clamping to the last day of a shorter month. */
export function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
}

export function parseMonth(text: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function parseWallClockSeconds(text: string): WallClock | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const date = parseCalendarDate(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { ...date, hour, minute, second };
}

export function parseWallClockMinutes(text: string): WallClock | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  return parseWallClockSeconds(`${text}:00`);
}

export function wallClockString(instant: Date, zone: string): string {
  const wall = wallClockOf(instant, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}T${pad(wall.hour, 2)}:${pad(
    wall.minute,
    2,
  )}:${pad(wall.second, 2)}`;
}
