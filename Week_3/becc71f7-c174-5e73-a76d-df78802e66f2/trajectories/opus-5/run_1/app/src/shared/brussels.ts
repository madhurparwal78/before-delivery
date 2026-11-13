/**
 * Business time for Atelier Ourlet. A Brussels day runs from local midnight to
 * local midnight, so it lasts 23 hours on 28 Mar 2027 and 25 hours on 31 Oct 2027.
 * Every Brussels day boundary in the product is decided here.
 */

export const TIME_ZONE = 'Europe/Brussels';

/** A Brussels calendar date, `YYYY-MM-DD`. */
export type BrusselsDate = string;
/** A Brussels calendar month, `YYYY-MM`. */
export type BrusselsMonth = string;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = [
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
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The Brussels wall clock at a UTC instant. */
export function wallClock(utcMs: number): WallClock {
  const parts = partsFormatter.formatToParts(utcMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return Number(part?.value ?? '0');
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Brussels local time minus UTC, in milliseconds, at a UTC instant. */
function offsetMs(utcMs: number): number {
  const w = wallClock(utcMs);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The Brussels date of a UTC instant. */
export function brusselsDate(utcMs: number): BrusselsDate {
  const w = wallClock(utcMs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** The Brussels month of a UTC instant. */
export function brusselsMonth(utcMs: number): BrusselsMonth {
  return brusselsDate(utcMs).slice(0, 7);
}

/** The UTC instant of Brussels local midnight starting a Brussels date. */
export function startOfBrusselsDay(date: BrusselsDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = wall - offsetMs(wall);
  return wall - offsetMs(firstPass);
}

/** The UTC instant of a Brussels wall-clock time on a Brussels date. */
export function brusselsInstant(
  date: BrusselsDate,
  hour: number,
  minute: number,
  second = 0,
): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = wall - offsetMs(wall);
  return wall - offsetMs(firstPass);
}

/** The Brussels date `days` calendar days after `date`. */
export function addDays(date: BrusselsDate, days: number): BrusselsDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(date: BrusselsDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday of the Monday-to-Sunday week holding `date`. */
export function mondayOf(date: BrusselsDate): BrusselsDate {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function monthOf(date: BrusselsDate): BrusselsMonth {
  return date.slice(0, 7);
}

export function firstDayOfMonth(month: BrusselsMonth): BrusselsDate {
  return `${month}-01`;
}

export function addMonths(month: BrusselsMonth, count: number): BrusselsMonth {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const total = year * 12 + (m - 1) + count;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

/** The UTC instant at which a Brussels month ends: 00:00 on the 1st of the next month. */
export function endOfBrusselsMonth(month: BrusselsMonth): number {
  return startOfBrusselsDay(firstDayOfMonth(addMonths(month, 1)));
}

export function isValidBrusselsDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isValidBrusselsMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** UTC in whole seconds with a Z, as every API instant is given. */
export function isoSeconds(utcMs: number): string {
  return new Date(Math.floor(utcMs / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function instantFromIso(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// ── Display formats ────────────────────────────────────────────────────────────

/** `Tue 30 Mar 2027` */
export function formatDate(utcMs: number): string {
  const w = wallClock(utcMs);
  const weekday = WEEKDAY_NAMES[weekdayOf(brusselsDate(utcMs))] ?? '';
  return `${weekday} ${pad(w.day)} ${MONTH_SHORT[w.month - 1]} ${w.year}`;
}

/** `Tue 30 Mar 2027` from a Brussels date. */
export function formatDateOnly(date: BrusselsDate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${pad(day)} ${MONTH_SHORT[month - 1]} ${year}`;
}

/** `Tue 30 Mar 2027, 10:20` */
export function formatDateTime(utcMs: number): string {
  return `${formatDate(utcMs)}, ${formatTime(utcMs)}`;
}

/** `14:30` */
export function formatTime(utcMs: number): string {
  const w = wallClock(utcMs);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** `March 2027` */
export function formatMonth(month: BrusselsMonth): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_LONG[m - 1]} ${year}`;
}

/** `2027-03-14 14:05`, the sales book's sale date-time. */
export function formatSheetDateTime(utcMs: number): string {
  const w = wallClock(utcMs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}
