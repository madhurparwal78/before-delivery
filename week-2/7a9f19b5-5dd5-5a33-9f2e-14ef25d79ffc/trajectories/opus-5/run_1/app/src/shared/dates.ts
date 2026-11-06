/**
 * The one date rule. Every date the server works from is the current date in
 * Pacific/Auckland, or `LIGHTFALL_TODAY` when that is set.
 */

export const SERVER_TIME_ZONE = "Pacific/Auckland";

/** A calendar date as `YYYY-MM-DD`. */
export type IsoDate = string;

export function todayInTimeZone(now: Date = new Date()): IsoDate {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not an ISO date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** An account invoice is due on the 20th of the month after its invoice date. */
export function dueDateFor(invoiceDate: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(invoiceDate);
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  return formatIsoDate(dueYear, dueMonth, 20);
}

/** Overdue from the 21st: the due date itself is still in time. */
export function isOverdue(dueDate: IsoDate, today: IsoDate): boolean {
  return today > dueDate;
}

/** `MM/YY` card expiry is valid while its month has not passed. */
export function isExpiryInFuture(expiry: string, today: IsoDate): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return false;
  const year = 2000 + Number(match[2]);
  const { year: nowYear, month: nowMonth } = parseIsoDate(today);
  return year > nowYear || (year === nowYear && month >= nowMonth);
}
