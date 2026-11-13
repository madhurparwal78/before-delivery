const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return toCalendarDate(ms) === value;
}

export function toCalendarDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return toCalendarDate(dateToMs(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dateToMs(to) - dateToMs(from)) / DAY_MS);
}

/** 0 = Sunday … 5 = Friday, 6 = Saturday. */
export function weekdayIndex(date: string): number {
  return new Date(dateToMs(date)).getUTCDay();
}

export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[weekdayIndex(date)] as string;
}

export function todayUtc(): string {
  return toCalendarDate(Date.now());
}
