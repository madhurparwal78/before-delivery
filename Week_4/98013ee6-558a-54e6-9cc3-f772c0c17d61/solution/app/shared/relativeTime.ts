/** The one relative-time rule, on the business clock and the configured time zone. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH_CUT = 28 * DAY;

function calendarParts(moment: number, timeZone: string): { month: string; day: string; year: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).formatToParts(new Date(moment));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return { month: pick("month"), day: pick("day"), year: pick("year") };
}

export function relativeTime(nowMs: number, thenMs: number, timeZone: string): string {
  const age = nowMs - thenMs;
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;
  if (age < MONTH_CUT) return `${Math.floor(age / WEEK)}w`;
  const then = calendarParts(thenMs, timeZone);
  const now = calendarParts(nowMs, timeZone);
  const shown = `${then.month} ${then.day}`;
  return then.year === now.year ? shown : `${shown}, ${then.year}`;
}

/** "1 pin", "2 pins": the published count texts. */
export const counted = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);
