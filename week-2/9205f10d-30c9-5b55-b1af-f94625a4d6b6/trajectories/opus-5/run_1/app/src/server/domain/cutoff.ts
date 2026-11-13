import { addDaysLocal, resolveLocalForgiving, toLocal } from './agency-time.js';

const FREE_CANCELLATION_DAYS = 2;

/**
 * The one free-cancellation cutoff rule: the request's local start time on the calendar
 * day two days before the start date, in agency time. Across a clock change this is 47
 * or 49 elapsed hours before the start rather than 48.
 */
export function freeCancelUntil(startsAt: Date): Date {
  const start = toLocal(startsAt);
  return resolveLocalForgiving(addDaysLocal(start, -FREE_CANCELLATION_DAYS));
}

export function isLateCancellation(startsAt: Date, now: Date): boolean {
  return now.getTime() >= freeCancelUntil(startsAt).getTime();
}
