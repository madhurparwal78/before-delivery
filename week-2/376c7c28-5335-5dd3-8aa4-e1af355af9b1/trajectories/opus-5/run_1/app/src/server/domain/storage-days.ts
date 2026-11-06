import { addDays, startOfStudioDay } from './studio-day.ts';

export const MAX_STORAGE_DAYS = 10;

export interface AccruedStorageDay {
  readonly date: string;
  readonly startInstant: Date;
}

/**
 * Storage-day accrual, decided only here: one day for each of the 10 studio days after the
 * pickup deadline at whose first instant the piece was still ready for pickup.
 */
export function accruedStorageDays(
  pickupDeadline: string,
  timeZone: string,
  now: Date,
  leftReadyAt: Date | null,
): AccruedStorageDay[] {
  const out: AccruedStorageDay[] = [];
  for (let offset = 1; offset <= MAX_STORAGE_DAYS; offset += 1) {
    const date = addDays(pickupDeadline, offset);
    const startInstant = startOfStudioDay(date, timeZone);
    if (startInstant.getTime() > now.getTime()) break;
    if (leftReadyAt !== null && startInstant.getTime() >= leftReadyAt.getTime()) break;
    out.push({ date, startInstant });
  }
  return out;
}

/** The first instant at which a pickup reminder is due: 3 calendar days before the deadline. */
export function reminderDueAt(pickupDeadline: string, timeZone: string): Date {
  return startOfStudioDay(addDays(pickupDeadline, -3), timeZone);
}
