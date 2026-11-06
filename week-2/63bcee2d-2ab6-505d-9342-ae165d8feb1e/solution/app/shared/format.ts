// Display formats the brief publishes for <time>, <date> and <amount>, shared by the server
// (emails, CSV, refusal copy) and the browser (announcements and tables).

export type Currency = "HKD" | "SGD";
export type TimeZone = "Asia/Hong_Kong" | "Asia/Singapore";

const ZONE_LABEL: Record<TimeZone, string> = { "Asia/Hong_Kong": "HKT", "Asia/Singapore": "SGT" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<TimeZone, Intl.DateTimeFormat>();

export function wallClock(instant: Date, zone: TimeZone): WallClock {
  let format = partsCache.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
    });
    partsCache.set(zone, format);
  }
  const value: Record<string, number> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== "literal") value[part.type] = Number(part.value);
  }
  return { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute, second: value.second };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `3 Nov 2026, 14:05:32 HKT` */
export function formatTime(instant: string | Date, zone: TimeZone = "Asia/Hong_Kong"): string {
  const c = wallClock(typeof instant === "string" ? new Date(instant) : instant, zone);
  return `${c.day} ${MONTHS[c.month - 1]} ${c.year}, ${two(c.hour)}:${two(c.minute)}:${two(c.second)} ${ZONE_LABEL[zone]}`;
}

/** `3 Nov 2026` from a calendar date `YYYY-MM-DD` */
export function formatDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** Today's calendar date `YYYY-MM-DD` in a zone. */
export function zoneToday(zone: TimeZone, instant: Date = new Date()): string {
  const c = wallClock(instant, zone);
  return `${c.year}-${two(c.month)}-${two(c.day)}`;
}

/** Plain decimal with two places from whole cents, `1250.00` (string arithmetic, never floats). */
export function plainAmount(cents: number): string {
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** `HKD 60,000.00` */
export function formatAmount(currency: Currency, cents: number): string {
  const [whole, fraction] = plainAmount(cents).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const grouped = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${sign}${grouped}.${fraction}`;
}

/** Whole numbers with comma separators, `10,000,000`. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
