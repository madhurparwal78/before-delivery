/**
 * Late days and the capped late fee: the one place that counts missed closing
 * instants and prices each late day at the rate in force on its own local date.
 */

import { addDays, closingInstant, isOpenDay, type LibraryCalendar, type LocalDate } from './calendar.js';

export interface LateFeeScheduleEntry {
  readonly effectiveFrom: LocalDate;
  readonly centsPerDay: number;
}

/** The schedule is held in ascending `effective_from` order. */
export function rateOn(schedule: readonly LateFeeScheduleEntry[], date: LocalDate): number {
  let rate = schedule[0]?.centsPerDay ?? 0;
  for (const entry of schedule) {
    if (entry.effectiveFrom <= date) rate = entry.centsPerDay;
    else break;
  }
  return rate;
}

/** The open days, from the due date onward, whose closing instant precedes the return. */
export function lateDays(
  calendar: LibraryCalendar,
  dueDate: LocalDate,
  returnedAt: Date,
): LocalDate[] {
  const days: LocalDate[] = [];
  let date = dueDate;
  for (let step = 0; step < 4000; step += 1) {
    if (isOpenDay(calendar, date)) {
      if (closingInstant(calendar, date).getTime() >= returnedAt.getTime()) break;
      days.push(date);
    }
    date = addDays(date, 1);
  }
  return days;
}

export interface LateFee {
  readonly lateDays: number;
  readonly lateFeeCents: number;
}

/** The sum of each late day's own rate, capped at the item's replacement value. */
export function lateFee(
  calendar: LibraryCalendar,
  schedule: readonly LateFeeScheduleEntry[],
  dueDate: LocalDate,
  returnedAt: Date,
  replacementCents: number,
): LateFee {
  const days = lateDays(calendar, dueDate, returnedAt);
  let sum = 0;
  for (const day of days) sum += rateOn(schedule, day);
  return { lateDays: days.length, lateFeeCents: Math.min(sum, replacementCents) };
}
