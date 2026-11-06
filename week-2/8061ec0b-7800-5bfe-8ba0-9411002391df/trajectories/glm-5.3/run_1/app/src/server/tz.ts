// Store time zone: America/Chicago. All date math on the server goes through
// this module so wall-clock times (cutoffs, midnight) use the right offset.
export const STORE_TIME_ZONE = "America/Chicago";

const datePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date): ZonedParts {
  const parts = datePartsFormatter.formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function storeDateString(instant: Date): string {
  const p = zonedParts(instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Convert a store-zone wall-clock time on a calendar date to a UTC instant.
// Uses the UTC offset in force at that local time.
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(guess));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const diff = asUtc - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function dateAtStoreTime(dateStr: string, hour: number, minute: number): Date {
  const [year, month, day] = dateStr.split("-").map((n) => Number(n));
  return zonedTimeToUtc(year, month, day, hour, minute);
}

export function weekdayOfDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map((n) => Number(n));
  const instant = zonedTimeToUtc(year, month, day, 12, 0);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: STORE_TIME_ZONE }).format(instant);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map((n) => Number(n));
  const instant = zonedTimeToUtc(year, month, day, 12, 0);
  const shifted = new Date(instant.getTime() + days * 86_400_000);
  return storeDateString(shifted);
}

// Billing date k: anchor plus k calendar months, day clamped to month end,
// always computed from the anchor.
export function billingDateFromAnchor(anchor: string, k: number): string {
  const [year, month, day] = anchor.split("-").map((n) => Number(n));
  const total = (year * 12 + (month - 1)) + k;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const lastDay = lastDayOfMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToDateString(dateStr: string, months: number): string {
  return billingDateFromAnchor(dateStr, months);
}

export function compareDateStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDaysToInstant(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
