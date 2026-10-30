import { addDays, localDate, localTime, resolveLocal } from './zone.js';

/** The one refund tier rule. */
export function refundTier(now: Date, startAt: Date, noticeHours: number): 'full' | 'none' {
  const deadline = startAt.getTime() - noticeHours * 3_600_000;
  return now.getTime() <= deadline ? 'full' : 'none';
}

/** The one unpaid cutoff rule: the booking's local start time two local days earlier. */
export function unpaidCutoff(zone: string, startAt: Date): Date {
  const date = localDate(zone, startAt);
  const time = localTime(zone, startAt);
  return resolveLocal(zone, addDays(date, -2), time);
}
