import type { RentalStatus } from '../../shared/api.js';
import { addDaysToBusinessDate, wallClockToInstantMs } from '../../shared/london.js';

const OPEN_STATUSES: readonly RentalStatus[] = ['requested', 'received', 'in_use'];

/** The business-zone date of the programme's latest performance plus 14 days. */
export function dueDateOf(finalPerformanceDate: string): string {
  return addDaysToBusinessDate(finalPerformanceDate, 14);
}

/** 23:59 London time on the due date. */
export function dueAtMs(dueDate: string): number {
  const [year, month, day] = dueDate.split('-').map(Number) as [number, number, number];
  const instant = wallClockToInstantMs({ year, month, day, hour: 23, minute: 59 });
  if (instant === null) throw new Error(`no 23:59 on ${dueDate} in London time`);
  return instant;
}

/** Overdue from 00:00 London time on the day after the due date, while the set is still out. */
export function isOverdue(status: RentalStatus, dueDate: string, todayBusinessDate: string): boolean {
  return OPEN_STATUSES.includes(status) && todayBusinessDate > dueDate;
}

/** Seven calendar days before the due date, in the business zone. */
export function reminderDateOf(dueDate: string): string {
  return addDaysToBusinessDate(dueDate, -7);
}

export function reminderIsDue(status: RentalStatus, dueDate: string, todayBusinessDate: string): boolean {
  return OPEN_STATUSES.includes(status) && todayBusinessDate >= reminderDateOf(dueDate);
}
