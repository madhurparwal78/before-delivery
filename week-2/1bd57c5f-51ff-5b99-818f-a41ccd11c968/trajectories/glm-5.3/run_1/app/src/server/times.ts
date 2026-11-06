const ZONE_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtZone(tz: string): Intl.DateTimeFormat {
  let f = ZONE_CACHE.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    ZONE_CACHE.set(tz, f);
  }
  return f;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(utc: Date, tz: string): LocalParts {
  const parts = fmtZone(tz).formatToParts(utc);
  const p: LocalParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    switch (part.type) {
      case "year": p.year = Number(part.value); break;
      case "month": p.month = Number(part.value); break;
      case "day": p.day = Number(part.value); break;
      case "hour": p.hour = Number(part.value === "24" ? "0" : part.value); break;
      case "minute": p.minute = Number(part.value); break;
      case "second": p.second = Number(part.value); break;
    }
  }
  return p;
}

export function offsetMinutesAt(utc: Date, tz: string): number {
  const p = localParts(utc, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - utc.getTime()) / 60000);
}

export type LocalToUtc = { utc: Date; exists: boolean };

/** Converts a job-local wall-clock time to UTC, using the offset rules on that
 *  date. A time that does not exist (spring-forward gap) reports exists false;
 *  a time that occurs twice reports its first occurrence. */
export function localToUtc(dateStr: string, hour: number, minute: number, second: number, tz: string): LocalToUtc {
  const naive = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)), hour, minute, second);
  const offBefore = offsetMinutesAt(new Date(naive - 26 * 3600000), tz);
  const offAfter = offsetMinutesAt(new Date(naive + 26 * 3600000), tz);
  const utcA = new Date(naive - offBefore * 60000);
  if (offsetMinutesAt(utcA, tz) === offBefore) {
    // The pre-transition offset round-trips: this is the first occurrence in a fold.
    return { utc: utcA, exists: true };
  }
  const utcB = new Date(naive - offAfter * 60000);
  if (offsetMinutesAt(utcB, tz) === offAfter) {
    return { utc: utcB, exists: true };
  }
  // Neither offset round-trips: the local time falls in the spring-forward gap.
  return { utc: utcA, exists: false };
}

export function toLocalString(utc: Date, tz: string): string {
  const p = localParts(utc, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

export function localDateOf(utc: Date, tz: string): string {
  return toLocalString(utc, tz).slice(0, 10);
}

export function utcIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)) + days));
  return d.toISOString().slice(0, 10);
}

export function dayDiff(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((db - da) / 86400000);
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function weekdayOf(dateStr: string): (typeof WEEKDAYS)[number] {
  const d = new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10))));
  return WEEKDAYS[d.getUTCDay()] ?? "MO";
}

export const WEEKDAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
