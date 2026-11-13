// Wall-clock arithmetic for the five member zones. Everything else asks this module about time.

export const TIME_ZONES = ["newYork", "chicago", "denver", "phoenix", "losAngeles"] as const;
export type TimeZone = (typeof TIME_ZONES)[number];

const IANA: Record<TimeZone, string> = {
  newYork: "America/New_York",
  chicago: "America/Chicago",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  losAngeles: "America/Los_Angeles",
};

const CITY: Record<TimeZone, string> = {
  newYork: "New York",
  chicago: "Chicago",
  denver: "Denver",
  phoenix: "Phoenix",
  losAngeles: "Los Angeles",
};

export function cityOf(zone: TimeZone): string {
  return CITY[zone];
}

export function isTimeZone(value: unknown): value is TimeZone {
  return TIME_ZONES.some((zone) => zone === value);
}

const formatters = new Map<TimeZone, Intl.DateTimeFormat>();

function formatter(zone: TimeZone): Intl.DateTimeFormat {
  const known = formatters.get(zone);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: IANA[zone],
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(zone, made);
  return made;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, zone: TimeZone): WallClock {
  const parts = new Map(formatter(zone).formatToParts(instant).map((part) => [part.type, part.value]));
  const read = (name: Intl.DateTimeFormatPartTypes): number => Number(parts.get(name) ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function localDate(instant: Date, zone: TimeZone): string {
  const clock = wallClock(instant, zone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

export function localTime(instant: Date, zone: TimeZone): string {
  const clock = wallClock(instant, zone);
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

function offsetMs(instant: Date, zone: TimeZone): number {
  const clock = wallClock(instant, zone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function dateParts(date: string): [number, number, number] {
  const [year = "0", month = "0", day = "0"] = date.split("-");
  return [Number(year), Number(month), Number(day)];
}

// The instant a wall-clock reading names in a zone. Two passes settle a reading next to a clock change.
export function instantOf(date: string, time: string, zone: TimeZone): Date {
  const [year, month, day] = dateParts(date);
  const [hour = "0", minute = "0"] = time.split(":");
  const naive = Date.UTC(year, month - 1, day, Number(hour), Number(minute));
  const first = naive - offsetMs(new Date(naive), zone);
  return new Date(naive - offsetMs(new Date(first), zone));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// 0 is Sunday, as in Date.getUTCDay.
export function weekdayOf(date: string): number {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = dateParts(value);
  const made = new Date(Date.UTC(year, month - 1, day));
  return made.getUTCFullYear() === year && made.getUTCMonth() === month - 1 && made.getUTCDate() === day;
}

export function wholeSeconds(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}
