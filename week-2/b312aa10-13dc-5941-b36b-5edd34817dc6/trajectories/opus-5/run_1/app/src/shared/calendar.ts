/** Zone-free calendar arithmetic and labels, shared by the server and the browser. */

export function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function parseDate(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isDate(text: unknown): text is string {
  return typeof text === 'string' && parseDate(text) !== null;
}

export function isMonth(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return false;
  const month = Number.parseInt(match[2]!, 10);
  return month >= 1 && month <= 12;
}

export function parseLocalTime(text: unknown): { hour: number; minute: number } | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  if (hour > 24 || minute > 59) return null;
  return { hour, minute };
}

export function minutesOfDay(time: string): number {
  const parsed = parseLocalTime(time);
  if (!parsed) throw new Error(`Not a local time: ${time}`);
  return parsed.hour * 60 + parsed.minute;
}

export function timeFromMinutes(minutes: number): string {
  if (minutes === 1440) return '24:00';
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`Not a date: ${date}`);
  const moved = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new Error('Not a date');
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000,
  );
}

const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof weekdayKeys)[number];
export const weekdayOrder: readonly WeekdayKey[] = weekdayKeys;

export function weekdayOf(date: string): WeekdayKey {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`Not a date: ${date}`);
  return weekdayKeys[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()]!;
}

export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, count: number): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5, 7), 10) - 1 + count;
  return `${year + Math.floor(index / 12)}-${pad2((((index % 12) + 12) % 12) + 1)}`;
}

const monthNames = [
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

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "November 2026" */
export function monthLabel(month: string): string {
  return `${monthNames[Number.parseInt(month.slice(5, 7), 10) - 1]} ${month.slice(0, 4)}`;
}

/** "Tuesday 27 October 2026" */
export function dateLabel(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  const weekday = weekdayNames[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()];
  return `${weekday} ${parsed.day} ${monthNames[parsed.month - 1]} ${parsed.year}`;
}
