import { createHash } from "node:crypto";

/**
 * Kitchen time. Every date is a kitchen-local `YYYY-MM-DD`, every time a
 * kitchen wall-clock `HH:MM`, and every instant a UTC `Date`. The device zone
 * never plays a part.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const offsetCache = new Map<string, number>();

function offsetAt(zone: string, instant: Date): number {
  const key = `${zone}|${instant.getTime()}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(instant);
  const asUtc = Date.parse(`${parts.replace(/(\d{4})(\d{2})(\d{2}), (\d{2}):(\d{2}):(\d{2})/, "$1-$2-$3T$4:$5:$6")}Z`);
  const offset = Math.round((asUtc - instant.getTime()) / 60000);
  if (offsetCache.size > 20000) {
    offsetCache.clear();
  }
  offsetCache.set(key, offset);
  return offset;
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) {
    return false;
  }
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  const d = Number.parseInt(date.slice(8, 10), 10);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

export function isValidWallTime(time: string): boolean {
  return TIME_RE.test(time);
}

/** The kitchen-local date of an instant. */
export function kitchenDate(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}

/** The kitchen wall-clock `HH:MM` of an instant. */
export function kitchenTime(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
  return parts === "24:00" ? "00:00" : parts;
}

/**
 * The instant of a kitchen wall-clock time. A time that does not exist because
 * of a spring-forward change moves forward by the length of the skipped hour; a
 * time that occurs twice in an autumn change uses the first occurrence.
 */
export function kitchenInstant(date: string, time: string, zone: string): Date {
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  const d = Number.parseInt(date.slice(8, 10), 10);
  const hh = Number.parseInt(time.slice(0, 2), 10);
  const mm = Number.parseInt(time.slice(3, 5), 10);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const firstOffset = offsetAt(zone, new Date(guess));
  const candidateA = guess - firstOffset * 60000;
  if (offsetAt(zone, new Date(candidateA)) === firstOffset) {
    // valid, but check for the second occurrence of an ambiguous time
    const probeBefore = candidateA - 6 * 3600000;
    const offsetBefore = offsetAt(zone, new Date(probeBefore));
    if (offsetBefore !== firstOffset) {
      const candidateB = guess - offsetBefore * 60000;
      if (offsetAt(zone, new Date(candidateB)) === offsetBefore) {
        return new Date(Math.min(candidateA, candidateB));
      }
    }
    return new Date(candidateA);
  }
  const offsetAfter = offsetAt(zone, new Date(candidateA));
  const candidateB = guess - offsetAfter * 60000;
  if (offsetAt(zone, new Date(candidateB)) === offsetAfter) {
    return new Date(candidateB);
  }
  // Nonexistent wall time: move forward by the length of the skipped hour.
  const skipped = Math.abs(offsetAfter - firstOffset);
  const shifted = guess + skipped * 60000 - offsetAfter * 60000;
  return new Date(shifted);
}

export function addDays(date: string, days: number): string {
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  const d = Number.parseInt(date.slice(8, 10), 10);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function dayOfWeek(date: string, zone: string): number {
  const instant = kitchenInstant(date, "12:00", zone);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(instant);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names.indexOf(label);
}

/** The next date (strictly after `date`) whose weekday is `weekday`. */
export function nextWeekday(date: string, weekday: number, zone: string): string {
  let d = addDays(date, 1);
  while (dayOfWeek(d, zone) !== weekday) {
    d = addDays(d, 1);
  }
  return d;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Quarter-hour index within the loom day: 04:00 is 0, 23:45 is 79. */
export function quarterOf(time: string): number {
  return (timeHourMinutes(time) - 4 * 60) / 15;
}

export function timeFromQuarter(q: number): string {
  const minutes = 4 * 60 + q * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function timeHourMinutes(time: string): number {
  return Number.parseInt(time.slice(0, 2), 10) * 60 + Number.parseInt(time.slice(3, 5), 10);
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function daysInMonth(month: string): { first: string; last: string } {
  const y = Number.parseInt(month.slice(0, 4), 10);
  const m = Number.parseInt(month.slice(5, 7), 10);
  const last = new Date(Date.UTC(y, m, 0));
  return {
    first: `${month}-01`,
    last: `${month}-${String(last.getUTCDate()).padStart(2, "0")}`,
  };
}

export function auditKey(kitchenId: string, date: string): string {
  return createHash("sha256").update(`${kitchenId}|${date}`).digest().readBigUInt64BE().toString();
}
