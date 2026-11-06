// Late days and the late fee. A late day is an open day, from the due date onward, whose closing instant
// is strictly before the return; each is priced at the rate in force on its own local date, and the sum is
// capped at the item's replacement value.

import type { LateFeeRate } from "../../shared/api.js";
import { addDays, closingInstant, isOpenDay, type LibraryCalendar } from "../../shared/calendar.js";

export function lateDates(calendar: LibraryCalendar, dueDate: string, returnedAt: Date): string[] {
  const late: string[] = [];
  for (let day = dueDate; closingInstant(calendar, day) < returnedAt; day = addDays(day, 1)) {
    if (isOpenDay(calendar, day)) late.push(day);
  }
  return late;
}

/** The rate of the latest schedule entry on or before `day`; days before the first entry use the first rate. */
export function rateOn(schedule: readonly LateFeeRate[], day: string): number {
  let rate = schedule[0]?.cents_per_day ?? 0;
  for (const entry of schedule) if (entry.effective_from <= day) rate = entry.cents_per_day;
  return rate;
}

export function lateFeeCents(schedule: readonly LateFeeRate[], late: readonly string[], replacementCents: number): number {
  const sum = late.reduce((total, day) => total + rateOn(schedule, day), 0);
  return Math.min(sum, replacementCents);
}
