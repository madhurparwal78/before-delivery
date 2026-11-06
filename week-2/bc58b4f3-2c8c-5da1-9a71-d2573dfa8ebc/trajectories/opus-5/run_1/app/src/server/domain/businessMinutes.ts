import { instantOf, partsOf } from '../../shared/zone.js';

export const LATE_NOTICE_THRESHOLD_MINUTES = 2880;

const SATURDAY = 6;

/**
 * Whole elapsed minutes between two instants, counting only minutes that fall on a
 * Monday to Friday in the agency zone.
 */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }
  let businessMs = 0;
  let cursor = from;
  while (cursor.getTime() < to.getTime()) {
    const parts = partsOf(cursor);
    const nextDay = instantOf(parts.year, parts.month, parts.day + 1, 0, 0);
    const segmentEnd = nextDay.getTime() < to.getTime() ? nextDay : to;
    if (parts.weekday < SATURDAY) {
      businessMs += segmentEnd.getTime() - cursor.getTime();
    }
    cursor = segmentEnd;
  }
  return Math.floor(businessMs / 60000);
}

export function isLateNotice(businessMinutes: number): boolean {
  return businessMinutes < LATE_NOTICE_THRESHOLD_MINUTES;
}
