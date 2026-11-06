import type { BaseKey } from '../../shared/format.js';
import { addDays, isSaturday, weekdayIndex } from '../../shared/zone.js';

export type Season = 'low' | 'shoulder' | 'high';
export const AVAILABILITY_WEEKS = 26;

export function seasonOf(weekStart: string): Season {
  const month = Number.parseInt(weekStart.slice(5, 7), 10);
  if (month === 7 || month === 8) return 'high';
  if (month === 5 || month === 6 || month === 9) return 'shoulder';
  return 'low';
}

export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 7);
}

/** The first Saturday strictly after the given Split date. */
export function firstWeekStartAfter(splitToday: string): string {
  const weekday = weekdayIndex(splitToday);
  return addDays(splitToday, weekday === 6 ? 7 : 6 - weekday);
}

export function availabilityWindow(splitToday: string): string[] {
  const first = firstWeekStartAfter(splitToday);
  return Array.from({ length: AVAILABILITY_WEEKS }, (_, index) => addDays(first, index * 7));
}

export function isWeekStartInFuture(weekStart: string, splitToday: string): boolean {
  return isSaturday(weekStart) && weekStart > splitToday;
}

export const VAT_PERCENT: Record<BaseKey, bigint> = { split: 13n, lavrio: 12n };
