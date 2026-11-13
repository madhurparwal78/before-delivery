import { now } from "./clock";
import { config } from "./config";
import { addDays, dayNumber } from "../shared/dates";
import type { CalendarState, DailyState } from "../shared/protocol";

const EPOCH_DAY = dayNumber("2026-01-01");

const zoneFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.dailyTz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date (yyyy-mm-dd) of an instant in the day zone. */
export function dateInZone(instant: Date): string {
  return zoneFormat.format(instant);
}

export const today = (): string => dateInZone(now());

/** `daily-k`, with k = (days from 2026-01-01 to the date) mod 7 + 1. */
export function dailyFixtureId(date: string): string {
  const days = dayNumber(date) - EPOCH_DAY;
  return `daily-${((days % 7) + 7) % 7 + 1}`;
}

/** A daily counts on its date only when the server received the finish on that date in the day zone. */
export function dailyStateOf(finishedAt: Date, date: string): DailyState {
  return dateInZone(finishedAt) === date ? "solved" : "late";
}

interface Streaks {
  current: number;
  best: number;
}

/** Current streak: consecutive solved dates ending today (or yesterday if today is unsolved). Best: the longest run. */
export function streaks(solved: ReadonlySet<string>, todayDate: string): Streaks {
  let current = 0;
  for (let day = solved.has(todayDate) ? todayDate : addDays(todayDate, -1); solved.has(day); day = addDays(day, -1)) current++;
  let best = 0;
  let run = 0;
  let previous = -Infinity;
  for (const day of [...solved].map(dayNumber).sort((a, b) => a - b)) {
    run = day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { current, best };
}

export function calendarState(date: string, todayDate: string, finished: DailyState | null): CalendarState {
  if (date < config.dailyStart) return "closed";
  if (date > todayDate) return "future";
  if (finished) return finished;
  return date === todayDate ? "today" : "missed";
}

export function daysOfMonth(month: string): string[] {
  const first = `${month}-01`;
  const days: string[] = [];
  for (let date = first; date.startsWith(month); date = addDays(date, 1)) days.push(date);
  return days;
}
