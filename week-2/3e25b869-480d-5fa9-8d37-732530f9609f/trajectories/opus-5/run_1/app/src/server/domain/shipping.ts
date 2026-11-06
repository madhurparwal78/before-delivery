import { addDays, isBusinessDay, torontoDate, torontoTimeOfDayMinutes } from '../../shared/toronto.js';

export function parseCutoffMinutes(cutoffLocal: string): number {
  const [hours, minutes] = cutoffLocal.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * A payment taken on a business day before the packing cutoff ships that day; anything else ships on
 * the next business day.
 */
export function shipOnFor(paidAt: Date, cutoffLocal: string): string {
  const today = torontoDate(paidAt);
  if (isBusinessDay(today) && torontoTimeOfDayMinutes(paidAt) < parseCutoffMinutes(cutoffLocal)) {
    return today;
  }
  let candidate = addDays(today, 1);
  while (!isBusinessDay(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}
