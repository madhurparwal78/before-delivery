/**
 * The shop-drawing review clock: five Hong Kong working days after the received
 * time, with a 17:00 HKT cut-off and the published general holidays.
 */

import { HK_ZONE } from '../../shared/domain.js';
import {
  addDays,
  formatCalendarDate,
  wallClockOf,
  weekdayOf,
  type CalendarDate,
} from '../../shared/zoned.js';

const HONG_KONG_HOLIDAYS = new Set<string>([
  '2026-01-01',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-04-03',
  '2026-04-04',
  '2026-04-06',
  '2026-04-07',
  '2026-05-01',
  '2026-05-25',
  '2026-06-19',
  '2026-07-01',
  '2026-09-26',
  '2026-10-01',
  '2026-10-19',
  '2026-12-25',
  '2026-12-26',
  '2027-01-01',
  '2027-02-06',
  '2027-02-08',
  '2027-02-09',
  '2027-03-26',
  '2027-03-27',
  '2027-03-29',
  '2027-04-05',
  '2027-05-01',
  '2027-05-13',
  '2027-06-09',
  '2027-07-01',
  '2027-09-16',
  '2027-10-01',
  '2027-10-08',
  '2027-12-25',
  '2027-12-27',
]);

const REVIEW_WORKING_DAYS = 5;
const CUT_OFF_HOUR = 17;

export function isWorkingDay(date: CalendarDate): boolean {
  const weekday = weekdayOf(date);
  if (weekday === 0 || weekday === 6) return false;
  return !HONG_KONG_HOLIDAYS.has(formatCalendarDate(date));
}

function nextWorkingDay(date: CalendarDate): CalendarDate {
  let candidate = addDays(date, 1);
  while (!isWorkingDay(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

/**
 * The working day the clock starts on: the received date itself when it is a
 * working day and the instant is at or before 17:00:00 HKT, otherwise the next
 * working day.
 */
export function reviewClockStart(receivedAt: Date): CalendarDate {
  const wall = wallClockOf(receivedAt, HK_ZONE);
  const date: CalendarDate = { year: wall.year, month: wall.month, day: wall.day };
  const atOrBeforeCutOff =
    wall.hour < CUT_OFF_HOUR ||
    (wall.hour === CUT_OFF_HOUR && wall.minute === 0 && wall.second === 0 &&
      receivedAt.getUTCMilliseconds() === 0);
  if (isWorkingDay(date) && atOrBeforeCutOff) return date;
  return nextWorkingDay(date);
}

/** The review due date: five working days after the start day. */
export function reviewDueOn(receivedAt: Date): string {
  let day = reviewClockStart(receivedAt);
  for (let counted = 0; counted < REVIEW_WORKING_DAYS; counted += 1) {
    day = nextWorkingDay(day);
  }
  return formatCalendarDate(day);
}

/** True while the latest submission is awaiting a return and the due date has passed. */
export function isOverdue(reviewDue: string, todayInHongKong: string): boolean {
  return todayInHongKong > reviewDue;
}
