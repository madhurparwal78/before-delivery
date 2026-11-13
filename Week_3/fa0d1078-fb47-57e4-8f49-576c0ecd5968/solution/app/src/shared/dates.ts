const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days from 1970-01-01 to a date written yyyy-mm-dd. */
export function dayNumber(date: string): number {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (date: string, days: number): string => fromDayNumber(dayNumber(date) + days);

/** True for a real calendar date written yyyy-mm-dd. */
export function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value) && fromDayNumber(dayNumber(value)) === value;
}

/** 0 for Monday to 6 for Sunday. */
export const weekdayOf = (date: string): number => (((dayNumber(date) + 3) % 7) + 7) % 7;
