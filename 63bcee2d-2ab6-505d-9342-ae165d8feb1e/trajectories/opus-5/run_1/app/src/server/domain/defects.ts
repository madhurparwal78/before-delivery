/** The defects end date: practical completion plus whole months, clamped. */

import { addMonthsClamped, formatCalendarDate, type CalendarDate } from '../../shared/zoned.js';

export function defectsEndOn(
  practicalCompletion: CalendarDate,
  defectsPeriodMonths: number,
): string {
  return formatCalendarDate(addMonthsClamped(practicalCompletion, defectsPeriodMonths));
}
