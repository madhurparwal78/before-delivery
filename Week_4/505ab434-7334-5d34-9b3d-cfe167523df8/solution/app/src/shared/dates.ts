// Dates and times in the workspace zone. Pure functions over ISO strings; the caller supplies the zone.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The instant at which the zone's wall clock reads the given local date and time. */
function zonedInstant(date: string, timeZone: string, hour = 0, minute = 0, second = 0, milli = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute, second, milli);
  let result = guess - offsetMs(guess, timeZone);
  const corrected = guess - offsetMs(result, timeZone);
  if (corrected !== result) result = corrected;
  return result;
}

export const toIso = (ms: number): string => new Date(ms).toISOString();

/** `YYYY-MM-DD` of an instant in the zone. */
export function localDate(iso: string, timeZone: string): string {
  const p = zonedParts(Date.parse(iso), timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** First instant of a calendar date in the zone. */
export function startOfDay(date: string, timeZone: string): string {
  return toIso(zonedInstant(date, timeZone));
}

/** 23:59:59.999 of a calendar date in the zone. */
export function endOfDay(date: string, timeZone: string): string {
  return toIso(zonedInstant(date, timeZone, 23, 59, 59, 999));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `D MMM YYYY` for an instant (ISO) in the zone. */
export function formatDate(iso: string, timeZone: string): string {
  const p = zonedParts(Date.parse(iso), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** `D MMM YYYY` for a calendar date (`YYYY-MM-DD`), no zone involved. */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `HH:mm` 24-hour for an instant in the zone. */
export function formatTime(iso: string, timeZone: string): string {
  const p = zonedParts(Date.parse(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `D MMM YYYY HH:mm`. */
export function formatStamp(iso: string, timeZone: string): string {
  return `${formatDate(iso, timeZone)} ${formatTime(iso, timeZone)}`;
}

export const isCalendarDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
