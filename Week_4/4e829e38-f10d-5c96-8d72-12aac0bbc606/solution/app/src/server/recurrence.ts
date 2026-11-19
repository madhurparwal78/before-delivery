/** The repeat rules: parsing the published phrases and finding the next due date. */
import { addDays, daysInMonth, WEEKDAYS, weekdayOf } from "./dates.js";

type Repeat =
  | { kind: "weekly"; weekday: number }
  | { kind: "monthly"; day: number }
  | { kind: "after"; days: number };

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parseRepeat(text: string | null): Repeat | null {
  if (!text) return null;
  const weekly = /^Every week on (\w+)$/.exec(text);
  if (weekly) {
    const weekday = WEEKDAY_NAMES.indexOf(weekly[1]);
    return weekday < 0 ? null : { kind: "weekly", weekday };
  }
  const monthly = /^Every month on day (\d{1,2})$/.exec(text);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return { kind: "monthly", day: Number(monthly[1]) };
  const after = /^Every (\d+) days after completion$/.exec(text);
  return after && Number(after[1]) >= 1 ? { kind: "after", days: Number(after[1]) } : null;
}

/** The next due date after `previousDue` (or after `completedOn` for the after-completion rule). */
export function nextDue(repeat: Repeat, previousDue: string, completedOn: string): string {
  if (repeat.kind === "after") return addDays(completedOn, repeat.days);
  if (repeat.kind === "weekly") {
    const current = WEEKDAYS.indexOf(weekdayOf(previousDue));
    const ahead = ((repeat.weekday - current + 6) % 7) + 1;
    return addDays(previousDue, ahead);
  }
  const [year, month] = previousDue.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const day = Math.min(repeat.day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
