import { DateTime } from 'luxon';
import { PRACTICE_ZONE } from './periods.js';

/**
 * One place that decides the reminder schedule: the state-local due date minus
 * the lead in calendar days, read at the bookkeeper's hour in Central time,
 * so the wall-clock hour holds across both daylight saving changes.
 */
export function reminderScheduledFor(
  dueDate: string,
  stateZone: string,
  leadDays: number,
  reminderHour: number,
): Date {
  const dayBefore = DateTime.fromISO(dueDate, { zone: stateZone }).minus({ days: leadDays });
  const at = DateTime.fromISO(dayBefore.toISODate() ?? '', { zone: PRACTICE_ZONE })
    .set({ hour: reminderHour, minute: 0, second: 0, millisecond: 0 });
  return at.toJSDate();
}
