export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const MONTH_NAMES = [
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

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > lastDayOfMonth(y, mo)) return false;
  return true;
}

export function parseDate(value: string): CivilDate {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`not a date: ${value}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function formatDate(date: CivilDate): string {
  return `${pad(date.y, 4)}-${pad(date.m, 2)}-${pad(date.d, 2)}`;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toEpochDay(date: CivilDate): number {
  return Math.floor(Date.UTC(date.y, date.m - 1, date.d) / 86400000);
}

export function fromEpochDay(epochDay: number): CivilDate {
  const dt = new Date(epochDay * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** 0 is Sunday, 6 is Saturday. */
export function dayOfWeek(date: CivilDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

export function isWeekend(date: CivilDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

/** `Monday June 22` */
export function longDate(date: CivilDate): string {
  return `${WEEKDAY_NAMES[dayOfWeek(date)]} ${MONTH_NAMES[date.m - 1]} ${date.d}`;
}

export function longDateString(value: string): string {
  return longDate(parseDate(value));
}

export function monthCaption(y: number, m: number): string {
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
