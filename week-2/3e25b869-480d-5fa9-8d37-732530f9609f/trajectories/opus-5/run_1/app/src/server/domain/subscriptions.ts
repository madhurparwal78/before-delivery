import { CADENCE_MONTHS } from '../../shared/catalog.js';
import { addMonthsOnAnchorDay, DATE_ONLY, startOfTorontoDay } from '../../shared/toronto.js';
import type { Cadence } from '../../shared/types.js';
import { config } from '../config.js';

function split(date: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** One step along the bill-date series that starts at the anchor. */
export function billDateAfterAnchor(anchor: string, cadence: Cadence, steps: number): string {
  const parts = split(anchor);
  return addMonthsOnAnchorDay(parts.year, parts.month, parts.day, steps * CADENCE_MONTHS[cadence]);
}

export function firstBillDate(startedOn: string, cadence: Cadence): string {
  return billDateAfterAnchor(startedOn, cadence, 1);
}

/** The next date in the series after `current`, so a short month never shifts the series. */
export function nextBillDateInSeries(anchor: string, cadence: Cadence, current: string): string {
  const anchorParts = split(anchor);
  const currentParts = split(current);
  const months = (currentParts.year - anchorParts.year) * 12 + (currentParts.month - anchorParts.month);
  const steps = Math.round(months / CADENCE_MONTHS[cadence]);
  return billDateAfterAnchor(anchor, cadence, steps + 1);
}

export function lockInstant(nextBillDate: string): Date {
  return new Date(
    startOfTorontoDay(nextBillDate).getTime() - config.subscriptionLockHours * 60 * 60 * 1_000,
  );
}

export function isLocked(nextBillDate: string | null, now: Date): boolean {
  if (nextBillDate === null) return false;
  return now.getTime() >= lockInstant(nextBillDate).getTime();
}
