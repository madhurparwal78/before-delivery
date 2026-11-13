/**
 * Asia/Kolkata calendar arithmetic. Kolkata is a fixed +05:30 offset with no
 * daylight saving, so every calendar decision is a shift of the instant followed
 * by plain UTC field reads. No result depends on the process time zone.
 */
const KOLKATA_OFFSET_MINUTES = 5 * 60 + 30;
const DAY_MS = 86_400_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type IsoDate = string;

export function kolkataDate(instant: Date): IsoDate {
  const shifted = new Date(instant.getTime() + KOLKATA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
}

function toUtcMidnight(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

/** `D Mon YYYY`, as every screen and PDF prints a date. */
export function formatDayMonthYear(date: IsoDate): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Reads a `YYMMDD` batch-code stamp as a date in the 2000s, or null. */
export function dateFromBatchStamp(stamp: string): IsoDate | null {
  if (!/^\d{6}$/.test(stamp)) return null;
  const candidate = `20${stamp.slice(0, 2)}-${stamp.slice(2, 4)}-${stamp.slice(4, 6)}`;
  return isValidIsoDate(candidate) ? candidate : null;
}
