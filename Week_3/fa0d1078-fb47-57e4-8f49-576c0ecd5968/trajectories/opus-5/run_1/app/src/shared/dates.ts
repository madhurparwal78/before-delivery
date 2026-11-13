/** A plain calendar date, `yyyy-mm-dd`. */
export type PlainDate = string;

const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES: readonly string[] = [
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
];

export const WEEKDAY_NAMES: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toDayNumber(value) !== null;
}

export function isMonthKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function toDayNumber(date: PlainDate): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const stamp = Date.UTC(year, month - 1, day);
  const back = new Date(stamp);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return Number.NaN;
  }
  return Math.round(stamp / MS_PER_DAY);
}

export function fromDayNumber(dayNumber: number): PlainDate {
  const date = new Date(dayNumber * MS_PER_DAY);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 for Monday through 6 for Sunday. */
export function mondayIndex(date: PlainDate): number {
  return ((toDayNumber(date) + 3) % 7 + 7) % 7;
}

export function monthKeyOf(date: PlainDate): string {
  return date.slice(0, 7);
}

export function monthLabel(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7));
  return `${MONTH_NAMES[month - 1]} ${monthKey.slice(0, 4)}`;
}

/** `November 3, 2026`. */
export function formatLongDate(date: PlainDate): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${MONTH_NAMES[month - 1]} ${day}, ${date.slice(0, 4)}`;
}

export function daysInMonth(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthDates(monthKey: string): PlainDate[] {
  const count = daysInMonth(monthKey);
  const dates: PlainDate[] = [];
  for (let day = 1; day <= count; day += 1) {
    dates.push(`${monthKey}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

/** Weeks of seven slots starting on Monday; neighbouring months are blank. */
export function monthWeeks(monthKey: string): (PlainDate | null)[][] {
  const dates = monthDates(monthKey);
  const first = dates[0] as PlainDate;
  const slots: (PlainDate | null)[] = Array.from({ length: mondayIndex(first) }, () => null);
  slots.push(...dates);
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks: (PlainDate | null)[][] = [];
  for (let index = 0; index < slots.length; index += 7) weeks.push(slots.slice(index, index + 7));
  return weeks;
}

export function addMonths(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7)) - 1 + delta;
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `daily-k`, with k = (days from 2026-01-01 to the date) mod 7 + 1. */
export function dailyPuzzleId(date: PlainDate): string {
  const offset = daysBetween('2026-01-01', date);
  return `daily-${((offset % 7) + 7) % 7 + 1}`;
}
