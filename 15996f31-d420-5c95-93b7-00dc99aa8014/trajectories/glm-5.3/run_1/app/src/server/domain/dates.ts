/**
 * Pacific (America/Los_Angeles) calendar and clock helpers. Every date written
 * for people is a Pacific calendar date; every date-time is Pacific on a
 * 12-hour clock.
 */

const PACIFIC = "America/Los_Angeles";

/** `YYYY-MM-DD` for the given instant in Pacific time. */
export function pacificDateParts(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Pacific calendar date parts (year, month, day) of an instant. */
export function pacificYmd(at: Date): { year: number; month: number; day: number } {
  const formatted = pacificDateParts(at);
  const [year, month, day] = formatted.split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Feb 5, 2027` for a `YYYY-MM-DD` date. */
export function formatDateText(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

/** `Feb 5, 2027, 3:30 PM` for an instant in Pacific time. */
export function formatDateTimeText(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour");
  return `${get("month")} ${get("day")}, ${get("year")}, ${hour}:${get("minute")} ${get("dayPeriod")}`;
}

/** `$1,234.50` for integer cents. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

/** `7.6` for integer tenths. */
export function formatAverage(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** True when `date` is a `YYYY-MM-DD` calendar date. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year!, month! - 1, day!));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month! - 1 && probe.getUTCDate() === day;
}
