// The date windows a hold, a walk-in and a renewal must fall in, judged on open days. Shared by the server,
// which decides, and the browser, which shows the same field copy before sending.

import { addDays, isIsoDate, isOpenDay, type LibraryCalendar } from "./calendar.js";
import { FIELD_COPY } from "./copy.js";

export const HORIZON_DAYS = 27;
export const MAX_SPAN_DAYS = 7;

/** Field errors for a hold's pickup and return dates (`today` in library time). */
export function holdDateErrors(calendar: LibraryCalendar, today: string, start: unknown, end: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const startOk = isIsoDate(start) && isOpenDay(calendar, start) && start >= today && start <= addDays(today, HORIZON_DAYS);
  if (!startOk) errors.start_date = FIELD_COPY.start_date;
  const endOk = isIsoDate(end) && isOpenDay(calendar, end) && (!startOk || (end >= (start as string) && end <= addDays(start as string, MAX_SPAN_DAYS)));
  if (!endOk) errors.end_date = FIELD_COPY.end_date;
  return errors;
}

/** Whether a walk-in may be due on `due`, counting from the local date of its checkout. */
export function walkInDueOk(calendar: LibraryCalendar, checkoutDate: string, due: unknown): due is string {
  return isIsoDate(due) && isOpenDay(calendar, due) && due >= checkoutDate && due <= addDays(checkoutDate, MAX_SPAN_DAYS);
}

/** The latest date a renewal may move a loan to. */
export const lastRenewalDate = (dueDate: string): string => addDays(dueDate, MAX_SPAN_DAYS);

/** Whether a renewal may move a loan due on `dueDate` to `next`. */
export function renewalDueOk(calendar: LibraryCalendar, dueDate: string, next: unknown): next is string {
  return isIsoDate(next) && isOpenDay(calendar, next) && next > dueDate && next <= lastRenewalDate(dueDate);
}
