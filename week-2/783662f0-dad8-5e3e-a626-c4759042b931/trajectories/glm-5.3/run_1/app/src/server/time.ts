/** Time helpers: UTC instants with milliseconds, and labels in a server's time zone. */

export function utcNow(): Date {
  return new Date();
}

/** 2026-11-01T18:07:42.123Z */
export function isoInstant(date: Date): string {
  return `${date.toISOString().slice(0, 23)}Z`;
}

const labelFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function labelFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = labelFormatterCache.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    labelFormatterCache.set(timeZone, f);
  }
  return f;
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateFormatterCache.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatterCache.set(timeZone, f);
  }
  return f;
}

function partsOf(date: Date, timeZone: string): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = labelFormatter(timeZone).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** YYYY-MM-DD HH:MM in the server's time zone, e.g. 2026-11-01 18:07 */
export function zoneLabel(date: Date, timeZone: string): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** YYYY-MM-DD HH:MM <time zone>, the suspends_at_label and expiry label form. */
export function zoneLabelWithZone(date: Date, timeZone: string): string {
  return `${zoneLabel(date, timeZone)} ${timeZone}`;
}

/** YYYY-MM-DD of the instant in the zone. */
export function zoneDate(date: Date, timeZone: string): string {
  return dateFormatter(timeZone).format(date);
}

/** The seconds until the next midnight in the zone, rounded up. */
export function secondsUntilMidnight(timeZone: string): number {
  const now = utcNow();
  const next = new Date(now);
  next.setUTCSeconds(next.getUTCSeconds() + 86400);
  // Walk in minute steps to the first instant whose zone date changes.
  let probe = new Date(now.getTime() + 60000);
  const currentDate = zoneDate(now, timeZone);
  for (let i = 0; i < 60 * 48; i++) {
    if (zoneDate(probe, timeZone) !== currentDate) {
      const seconds = Math.ceil((probe.getTime() - now.getTime()) / 1000);
      return Math.max(seconds, 0);
    }
    probe = new Date(probe.getTime() + 60000);
  }
  return 86400;
}

/** True when the instant falls on the same zone day as the reference. */
export function sameZoneDay(a: Date, b: Date, timeZone: string): boolean {
  return zoneDate(a, timeZone) === zoneDate(b, timeZone);
}

/** The plan of the recurring charge on an invoice, as "hamlet" or "borough", or null. */
export function planOfPlanName(planName: string | null): "hamlet" | "borough" | null {
  if (planName === null) return null;
  if (planName.startsWith("hamlet")) return "hamlet";
  if (planName.startsWith("borough")) return "borough";
  return null;
}
