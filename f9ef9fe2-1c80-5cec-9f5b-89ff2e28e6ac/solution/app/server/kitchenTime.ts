// Kitchen wall-clock time. Every date and time the app judges goes through these functions with
// the kitchen's IANA zone; the device and server zones never matter.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(zone: string, epochMs: number): WallClock {
  const values: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function offsetMs(zone: string, epochMs: number): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const w = wallClock(zone, whole);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function kitchenDate(zone: string, at: Date): string {
  const w = wallClock(zone, at.getTime());
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Minutes past kitchen midnight. */
export function kitchenMinutes(zone: string, at: Date): number {
  const w = wallClock(zone, at.getTime());
  return w.hour * 60 + w.minute;
}

export function kitchenClock(zone: string, at: Date): string {
  return clockOf(kitchenMinutes(zone, at));
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function clockOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * The instant of a kitchen date and wall-clock time ("24:00" is the next midnight). A time skipped
 * by a spring-forward change moves forward by the skipped length; a repeated time uses the first
 * occurrence.
 */
export function toInstant(zone: string, date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, 0, minutesOf(hhmm));
  const halfDay = 12 * 3600 * 1000;
  const early = wall - offsetMs(zone, wall - halfDay);
  const late = wall - offsetMs(zone, wall + halfDay);
  const valid = [early, late].filter((t) => t + offsetMs(zone, t) === wall);
  return new Date(valid.length > 0 ? Math.min(...valid) : early);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return moved.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isQuarterHour(value: unknown, first: number, last: number): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const minutes = minutesOf(value);
  const [, m] = value.split(":");
  return Number(m) < 60 && minutes % 15 === 0 && minutes >= first && minutes <= last;
}
