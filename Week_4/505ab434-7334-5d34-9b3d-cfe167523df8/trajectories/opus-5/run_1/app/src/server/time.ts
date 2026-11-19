import { config } from './config.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function zonedParts(date: Date): ZonedParts {
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Missing ${type} in formatted date`);
    return Number(part.value);
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

function offsetMs(date: Date): number {
  const parts = zonedParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, date.getUTCMilliseconds());
  return asUtc - date.getTime();
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let timestamp = asUtc - offsetMs(new Date(asUtc));
  timestamp = asUtc - offsetMs(new Date(timestamp));
  return new Date(timestamp);
}

/** The calendar date in the business time zone, as YYYY-MM-DD. */
export function businessDate(date: Date): string {
  const parts = zonedParts(date);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function splitDate(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Not a calendar date: ${isoDate}`);
  }
  return [year, month, day];
}

export function startOfDay(isoDate: string): Date {
  const [year, month, day] = splitDate(isoDate);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, 0);
}

export function endOfDay(isoDate: string): Date {
  const [year, month, day] = splitDate(isoDate);
  return zonedTimeToUtc(year, month, day, 23, 59, 59, 999);
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = splitDate(isoDate);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

export function compareDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

/** `D MMM YYYY`, for example `15 Apr 2026`. */
export function formatDisplayDate(value: string | Date): string {
  const parts = typeof value === 'string' ? splitDateParts(value) : zonedParts(value);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

function splitDateParts(isoDate: string): ZonedParts {
  const [year, month, day] = splitDate(isoDate);
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

/** `HH:mm` in 24-hour form. */
export function formatDisplayTime(date: Date): string {
  const parts = zonedParts(date);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** `D MMM YYYY HH:mm`. */
export function formatDisplayDateTime(date: Date): string {
  return `${formatDisplayDate(date)} ${formatDisplayTime(date)}`;
}

/** ISO 8601 UTC with milliseconds and `Z`. */
export function isoInstant(date: Date): string {
  return date.toISOString();
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}
