import { addDays, daysInMonth, weekdayOf } from './time.js';

export const COMPLAINT_WORKING_DAYS = 3;
export const COMPLAINT_CUTOFF_TIME = '17:00';

function isWorkingDay(date: string, holidays: Set<string>): boolean {
  const day = weekdayOf(date);
  return day !== 0 && day !== 6 && !holidays.has(date);
}

function nextWorkingDay(date: string, holidays: Set<string>): string {
  let day = addDays(date, 1);
  while (!isWorkingDay(day, holidays)) day = addDays(day, 1);
  return day;
}

/** Three working days in England and Wales, counted from the next working day after 17:00. */
export function complaintReplyDue(
  receivedDate: string,
  receivedTime: string,
  holidays: Set<string>,
): string {
  let from = receivedDate;
  if (receivedTime >= COMPLAINT_CUTOFF_TIME || !isWorkingDay(from, holidays)) {
    from = nextWorkingDay(from, holidays);
  }
  let due = from;
  for (let counted = 0; counted < COMPLAINT_WORKING_DAYS; counted += 1) {
    due = nextWorkingDay(due, holidays);
  }
  return due;
}

/** One calendar month after the day an item was found, clamped to the month's end. */
export function holdingDate(foundOn: string): string {
  const [year, month, day] = foundOn.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = daysInMonth(nextYear, nextMonth);
  const landedDay = Math.min(day, lastDay);
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(landedDay).padStart(2, '0')}`;
}

export const RETURN_CHARGE_PENNIES = 500;
