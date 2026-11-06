import { addDays, compareBusinessDates } from './time.js';

/**
 * Next due. The date is the business date of the horse's last visit in any state other
 * than open, plus 7 × cycle weeks; the status compares it with today in the practice zone.
 */
export type DueStatus = 'current' | 'due' | 'overdue' | 'unknown';

export interface NextDue {
  lastWorkedDate: string | null;
  nextDueDate: string | null;
  dueStatus: DueStatus;
}

export function nextDue(
  lastWorkedDate: string | null,
  cycleWeeks: number,
  today: string,
): NextDue {
  if (lastWorkedDate === null) {
    return { lastWorkedDate: null, nextDueDate: null, dueStatus: 'unknown' };
  }
  const nextDueDate = addDays(lastWorkedDate, 7 * cycleWeeks);
  const windowOpens = addDays(nextDueDate, -7);
  let dueStatus: DueStatus;
  if (compareBusinessDates(today, windowOpens) < 0) dueStatus = 'current';
  else if (compareBusinessDates(today, nextDueDate) <= 0) dueStatus = 'due';
  else dueStatus = 'overdue';
  return { lastWorkedDate, nextDueDate, dueStatus };
}
