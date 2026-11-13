// The kitchen clock: every date and time rule works in kitchen-local wall-clock time in the
// configured IANA zone, never the host's zone. Server and browser both use this module.

export const OPENS_MINUTE = 5 * 60;
export const CLOSES_MINUTE = 23 * 60;
export const HALF_HOUR = 30;
export const MINUTE_MS = 60_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: number, zone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0,
    hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(instant: number, zone: string): number {
  const p = localParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE_MS);
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

function dateOf(parts: { year: number; month: number; day: number }): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The kitchen-local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(instant: number, zone: string): string {
  return dateOf(localParts(instant, zone));
}

/** Minutes since kitchen-local midnight. */
export function localMinute(instant: number, zone: string): number {
  const p = localParts(instant, zone);
  return p.hour * 60 + p.minute;
}

/** The instant a kitchen-local wall-clock time names on a kitchen date. */
export function zonedInstant(date: string, minuteOfDay: number, zone: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`not a date: ${date}`);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + minuteOfDay * MINUTE_MS;
  let instant = wall - offsetMinutes(wall, zone) * MINUTE_MS;
  const corrected = wall - offsetMinutes(instant, zone) * MINUTE_MS;
  if (corrected !== instant) instant = corrected;
  return instant;
}

/** ISO 8601 with the kitchen's UTC offset, e.g. 2026-10-28T05:00:00-05:00. */
export function isoInZone(instant: number, zone: string): string {
  const p = localParts(instant, zone);
  const offset = offsetMinutes(instant, zone);
  const sign = offset < 0 ? "-" : "+";
  return `${dateOf(p)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

export function isDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function addDays(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`not a date: ${date}`);
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return dateOf({ year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() });
}

/** Whole kitchen days from one date to a later (or earlier, negative) one. */
export function daysBetween(from: string, to: string): number {
  const parse = (date: string): number => {
    const match = DATE_PATTERN.exec(date);
    if (!match) throw new RangeError(`not a date: ${date}`);
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** A kitchen-local date written like "Wed 28 Oct 2026". */
export function dateLabel(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) return date;
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${WEEKDAYS[probe.getUTCDay()]} ${probe.getUTCDate()} ${MONTHS[probe.getUTCMonth()]} ${probe.getUTCFullYear()}`;
}

/** 24-hour kitchen time like "05:00" for a minute of the day. */
export function clockText(minuteOfDay: number): string {
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

export function parseClock(value: string): number | null {
  const match = HHMM_PATTERN.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** A span is on the half hour, inside 05:00–23:00, and starts before it ends. */
export function isSpan(from: number, to: number): boolean {
  return from % HALF_HOUR === 0 && to % HALF_HOUR === 0 && from >= OPENS_MINUTE && to <= CLOSES_MINUTE && from < to;
}

/**
 * A confirmed booking's cancellation cutoff: the same kitchen-local wall-clock time on the
 * calendar day before its start (23 or 25 elapsed hours across a daylight-saving change).
 */
export function cancellationCutoff(start: number, zone: string): number {
  return zonedInstant(addDays(localDate(start, zone), -1), localMinute(start, zone), zone);
}
