// Charter weeks on the Split calendar (brief: Charter weeks).
import { addDays, localDate, weekday } from "../../shared/zones";
import type { Season } from "./yachts";

const WEEKS_IN_WINDOW = 26;

export function splitToday(nowMs: number): string {
  return localDate(nowMs, "split");
}

/** The 26 weeks whose Saturdays come after Split today. */
export function availabilityWindow(nowMs: number): string[] {
  const today = splitToday(nowMs);
  const ahead = (6 - weekday(today) + 7) % 7 || 7;
  const first = addDays(today, ahead);
  return Array.from({ length: WEEKS_IN_WINDOW }, (_, i) => addDays(first, i * 7));
}

export function weekEnd(weekStart: string): string {
  return addDays(weekStart, 7);
}

export function seasonOf(weekStart: string): Season {
  const month = Number(weekStart.slice(5, 7));
  if (month === 7 || month === 8) return "high";
  if (month === 5 || month === 6 || month === 9) return "shoulder";
  return "low";
}
