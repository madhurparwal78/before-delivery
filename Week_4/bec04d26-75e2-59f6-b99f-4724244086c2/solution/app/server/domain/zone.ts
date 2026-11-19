import { addDays, formatDate, parseDate, weekday } from "../../shared/calendar";

/** The practice keeps its clock, reminders and weeks in Central time. */
export const PRACTICE_ZONE = "America/Chicago";

const ZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific",
  "Pacific/Honolulu": "Hawaii",
};

export const zoneLabel = (zone: string): string => ZONE_LABELS[zone] ?? zone;

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(ms: number, zone: string) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(zone, format);
  }
  const part = Object.fromEntries(format.formatToParts(ms).map((p) => [p.type, Number(p.value)]));
  return { year: part.year, month: part.month, day: part.day, hour: part.hour, minute: part.minute, second: part.second };
}

export function isKnownZone(zone: string): boolean {
  try {
    wallClock(0, zone);
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone's wall clock is ahead of UTC at an instant. */
export function offsetMinutes(ms: number, zone: string): number {
  const w = wallClock(ms, zone);
  return (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000) / 60000;
}

/** The instant at which the zone's wall clock reads the given local date and time. */
export function zonedInstant(date: string, hour: number, minute: number, second: number, millisecond: number,
  zone: string): number {
  const [year, month, day] = parseDate(date);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const first = asUtc - offsetMinutes(asUtc, zone) * 60000;
  return asUtc - offsetMinutes(first, zone) * 60000;
}

export function localDate(ms: number, zone: string): string {
  const w = wallClock(ms, zone);
  return formatDate(w.year, w.month, w.day);
}

export function localMinuteOfDay(ms: number, zone: string): number {
  const w = wallClock(ms, zone);
  return w.hour * 60 + w.minute;
}

/** `11:59 pm` */
export function clockWords(ms: number, zone: string): string {
  const w = wallClock(ms, zone);
  return `${w.hour % 12 || 12}:${String(w.minute).padStart(2, "0")} ${w.hour < 12 ? "am" : "pm"}`;
}

/** Monday to Sunday week holding the instant's local date. */
export function weekOf(ms: number, zone: string): { start: string; end: string } {
  const today = localDate(ms, zone);
  const start = addDays(today, -((weekday(today) + 6) % 7));
  return { start, end: addDays(start, 6) };
}
