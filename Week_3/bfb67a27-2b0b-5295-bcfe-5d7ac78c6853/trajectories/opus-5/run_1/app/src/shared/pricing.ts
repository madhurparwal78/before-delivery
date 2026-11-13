import type { DayKind, PriceDay } from './types.js';
import { addDays, weekdayIndex } from './dates.js';

const FRIDAY = 5;
export const MIN_HIRE_DAYS = 1;
export const MAX_HIRE_DAYS = 14;

/**
 * The house pricing rules, decided here and nowhere else.
 *
 * Friday weekend: pickup on a Friday with 2 or 3 hire days bills as one day and
 * every day is a `weekend` day. Otherwise each 7-day block bills its first
 * three days and gives the rest free.
 */
export function hireDayKinds(pickupDate: string, hireDays: number): DayKind[] {
  if (weekdayIndex(pickupDate) === FRIDAY && (hireDays === 2 || hireDays === 3)) {
    return Array.from({ length: hireDays }, () => 'weekend' as const);
  }
  return Array.from({ length: hireDays }, (_unused, index) =>
    index % 7 >= 3 ? ('free' as const) : ('billable' as const),
  );
}

export function billableDaysFor(pickupDate: string, hireDays: number): number {
  const kinds = hireDayKinds(pickupDate, hireDays);
  if (kinds[0] === 'weekend') return 1;
  return kinds.filter((kind) => kind === 'billable').length;
}

export function hireDaySchedule(pickupDate: string, hireDays: number): PriceDay[] {
  return hireDayKinds(pickupDate, hireDays).map((kind, index) => ({
    day: index + 1,
    date: addDays(pickupDate, index),
    kind,
  }));
}
