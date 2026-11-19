import { addDays, parseDate } from '../../shared/dates';
import { PRACTICE_ZONE, zonedToInstant } from './zones';

export const REMINDER_LEADS: readonly (7 | 1)[] = [7, 1];

export interface ScheduledReminder {
  leadDays: 7 | 1;
  scheduledForMs: number;
}

/**
 * The state-local due date minus the lead in calendar days, read at the
 * bookkeeper's reminder hour in Central time, so the wall-clock hour holds
 * across both daylight saving changes.
 */
export function reminderSchedule(dueDate: string, reminderHour: number): ScheduledReminder[] {
  const due = parseDate(dueDate);
  return REMINDER_LEADS.map((leadDays) => ({
    leadDays,
    scheduledForMs: zonedToInstant(PRACTICE_ZONE, addDays(due, -leadDays), reminderHour, 0, 0, 0),
  }));
}
