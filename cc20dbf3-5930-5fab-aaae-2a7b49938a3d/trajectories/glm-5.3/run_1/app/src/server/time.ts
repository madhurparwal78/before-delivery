const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = dayFormatterCache.get(zone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatterCache.set(zone, fmt);
  }
  return fmt;
}

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = offsetFormatterCache.get(zone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    offsetFormatterCache.set(zone, fmt);
  }
  return fmt;
}

/** The UTC offset, in minutes east of UTC, in force at the given instant. */
export function offsetMinutes(instant: Date, zone: string): number {
  const parts = offsetFormatter(zone).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The local date, as YYYY-MM-DD, of an instant in the library zone. */
export function localDate(instant: Date, zone: string): string {
  return dayFormatter(zone).format(instant);
}

/** The instant of a wall-clock date and time in the library zone, honouring the offset in force on that date. */
export function zonedInstant(date: string, hour: number, minute: number, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  let offset = offsetMinutes(new Date(naive), zone);
  let guess = naive - offset * 60000;
  offset = offsetMinutes(new Date(guess), zone);
  guess = naive - offset * 60000;
  return new Date(guess);
}

export function parseDate(value: string): { iso: string } | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { iso: value };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + days));
  const yy = result.getUTCFullYear();
  const mm = String(result.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(result.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function dateDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** <local time>, for example "Sun 1 Nov 2026, 18:00 EST". */
export function formatLocalTime(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${hour}:${get("minute")} ${get("timeZoneName")}`;
}

export function formatIso(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}
