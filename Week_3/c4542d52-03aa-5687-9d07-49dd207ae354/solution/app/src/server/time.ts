import { TIME_ZONE } from "../shared/format.js";

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const now = (): Date => new Date();

/** Tidecraft's date (Pacific) at an instant, as YYYY-MM-DD. */
export function pacificDate(instant: Date): string {
  return dateParts.format(instant);
}

export const iso = (instant: Date): string => instant.toISOString();

export const addSeconds = (instant: Date, seconds: number): Date => new Date(instant.getTime() + seconds * 1000);

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** The date `months` calendar months after `date`, clamped to the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const text = (value: number, width: number) => String(value).padStart(width, "0");
  return `${text(targetYear, 4)}-${text(targetMonth + 1, 2)}-${text(Math.min(day, lastDay), 2)}`;
}
