const pad = (value: number): string => String(value).padStart(2, "0");

export type CalendarDay = { year: number; month: number; day: number };

export const dayString = ({ year, month, day }: CalendarDay): string => `${year}-${pad(month)}-${pad(day)}`;

/** The device's plain calendar date; never passes through a time zone again. */
export function today(): string {
  const now = new Date();
  return dayString({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function parseDay(text: string): CalendarDay {
  const [year = 1970, month = 1, day = 1] = text.split("-").map(Number);
  return { year, month, day };
}

const utc = ({ year, month, day }: CalendarDay): Date => new Date(Date.UTC(year, month - 1, day));

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Weekday of the first of the month, Sunday 0. */
export const firstWeekday = (year: number, month: number): number => utc({ year, month, day: 1 }).getUTCDay();

export function addDays(day: CalendarDay, count: number): CalendarDay {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + count);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addMonths(day: CalendarDay, count: number): CalendarDay {
  const index = day.year * 12 + day.month - 1 + count;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export const longDate = (day: CalendarDay): string => LONG_DATE.format(utc(day));
export const monthTitle = (day: CalendarDay): string => MONTH.format(utc(day));
export const shortDate = (time: number): string => SHORT_DATE.format(time);
