const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;

const wallFormats = new Map<string, Intl.DateTimeFormat>();
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function wallFormat(zone: string): Intl.DateTimeFormat {
  let format = wallFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    wallFormats.set(zone, format);
  }
  return format;
}

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }

function wall(zone: string, at: number): Wall {
  const parts: Record<string, number> = {};
  for (const part of wallFormat(zone).formatToParts(at)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return { year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day ?? 1, hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0 };
}

/** Minutes the zone's wall clock is ahead of UTC at that instant. */
function offsetMinutes(zone: string, at: number): number {
  const w = wall(zone, at);
  return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000) / MINUTE);
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The clock-change rule, the one place a local date and wall time become an instant
 * (brief: Business rules, Clock-change rule): a wall time inside the spring gap moves forward by the
 * gap's length; a wall time that happens twice means its first, earlier occurrence.
 */
export function resolveLocal(zone: string, date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetMinutes(zone, asUtc - DAY);
  const after = offsetMinutes(zone, asUtc + DAY);
  const valid = [before, after]
    .map((offset) => asUtc - offset * MINUTE)
    .filter((candidate, index) => offsetMinutes(zone, candidate) === [before, after][index]);
  return new Date(valid.length > 0 ? Math.min(...valid) : asUtc - before * MINUTE);
}

export function localDate(zone: string, at: Date): string {
  const w = wall(zone, at.getTime());
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function localTime(zone: string, at: Date): string {
  const w = wall(zone, at.getTime());
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** The zone's abbreviation at that instant, for example CDT. */
export function zoneAbbreviation(zone: string, at: Date): string {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    zoneFormats.set(zone, format);
  }
  return format.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? zone;
}

/** "YYYY-MM-DD HH:MM <zone>" as printed on bookings, tickets, invoices and emails. */
export function localStamp(zone: string, at: Date): string {
  return `${localDate(zone, at)} ${localTime(zone, at)} ${zoneAbbreviation(zone, at)}`;
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Calendar arithmetic on a local date string (no instants involved). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export interface LocalDay { start: Date; end: Date; minutes: number }

/** A site's local day: 1,380, 1,440 or 1,500 minutes between two resolved midnights. */
export function localDay(zone: string, date: string): LocalDay {
  const start = resolveLocal(zone, date, "00:00");
  const end = resolveLocal(zone, addDays(date, 1), "00:00");
  return { start, end, minutes: Math.round((end.getTime() - start.getTime()) / MINUTE) };
}

/** Every local date a half-open interval touches. */
export function datesTouched(zone: string, start: Date, end: Date): string[] {
  const dates: string[] = [];
  const last = localDate(zone, new Date(end.getTime() - 1));
  for (let date = localDate(zone, start); date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function elapsedMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MINUTE);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE);
}
