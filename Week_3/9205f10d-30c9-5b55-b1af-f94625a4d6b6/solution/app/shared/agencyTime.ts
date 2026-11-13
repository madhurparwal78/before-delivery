/**
 * Agency time: every date, week, cutoff, expiry and clock shown is decided in the agency's zone,
 * whatever zone the server or the browser runs in.
 */
export const AGENCY_ZONE = "America/New_York";

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const labelFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** The agency wall clock (to the second) at an instant. */
function wallAt(instant: Date): WallClock & { second: number } {
  const parts = wallFormat.formatToParts(instant);
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second")),
  };
}

/** Minutes the agency clock is ahead of UTC at an instant (negative in America/New_York). */
function offsetMinutes(instant: Date): number {
  const w = wallAt(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE_MS);
}

function wallMs(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
}

function sameWall(instant: Date, w: WallClock): boolean {
  const at = wallAt(instant);
  return at.year === w.year && at.month === w.month && at.day === w.day && at.hour === w.hour && at.minute === w.minute;
}

/** Every instant that shows this wall clock: none when it is skipped, two when it repeats. */
function instantsShowing(w: WallClock): Date[] {
  const naive = wallMs(w);
  const offsets = new Set([offsetMinutes(new Date(naive - DAY_MS)), offsetMinutes(new Date(naive + DAY_MS))]);
  return [...offsets]
    .map((offset) => new Date(naive - offset * MINUTE_MS))
    .filter((instant) => sameWall(instant, w))
    .sort((a, b) => a.getTime() - b.getTime());
}

/** The first instant showing this wall clock, or null when clocks skip it. */
export function fromWallClock(w: WallClock): Date | null {
  return instantsShowing(w)[0] ?? null;
}

/**
 * The instant for a wall clock, where a skipped wall clock resolves to the first instant after
 * the skipped stretch (the moment clocks spring forward).
 */
export function fromWallClockOrAfterGap(w: WallClock): Date {
  const found = fromWallClock(w);
  if (found) return found;
  const naive = wallMs(w);
  const before = offsetMinutes(new Date(naive - DAY_MS));
  const after = offsetMinutes(new Date(naive + DAY_MS));
  let low = naive - after * MINUTE_MS;
  let high = naive - before * MINUTE_MS;
  while (high - low > MINUTE_MS) {
    const mid = low + Math.floor((high - low) / MINUTE_MS / 2) * MINUTE_MS;
    if (offsetMinutes(new Date(mid)) === after) high = mid;
    else low = mid;
  }
  return new Date(high);
}

export function wallClockAt(instant: Date): WallClock {
  const { year, month, day, hour, minute } = wallAt(instant);
  return { year, month, day, hour, minute };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function formatIsoDate(w: { year: number; month: number; day: number }): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** ISO 8601 with the agency's UTC offset, e.g. 2026-11-03T09:00:00-05:00. */
export function toAgencyIso(instant: Date): string {
  const w = wallAt(instant);
  const offset = offsetMinutes(instant);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${formatIsoDate(w)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The agency calendar date (YYYY-MM-DD) at an instant. */
export function agencyDate(instant: Date): string {
  return formatIsoDate(wallAt(instant));
}

/** Parses YYYY-MM-DD into a real calendar date, or null. */
export function parseIsoDate(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Adds whole calendar days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate);
  if (!d) throw new RangeError(`not a date: ${isoDate}`);
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return formatIsoDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

/** The Monday (YYYY-MM-DD) of the agency week holding a date. */
export function weekMonday(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  if (!d) throw new RangeError(`not a date: ${isoDate}`);
  const weekday = (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
  return addDays(isoDate, -weekday);
}

interface ClockLabels {
  /** "Tue" */
  weekday: string;
  /** "Nov 3" */
  monthDay: string;
  /** "9:00 AM" */
  clock: string;
  /** "EST" or "EDT" */
  zone: string;
}

/** Display parts of an instant in agency time. */
export function clockLabels(instant: Date): ClockLabels {
  const parts = labelFormat.formatToParts(instant);
  return {
    weekday: part(parts, "weekday"),
    monthDay: `${part(parts, "month")} ${part(parts, "day")}`,
    clock: `${part(parts, "hour")}:${part(parts, "minute")} ${part(parts, "dayPeriod").toUpperCase()}`,
    zone: part(parts, "timeZoneName"),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Dec 31, 2030" for a calendar date. */
export function longDate(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  if (!d) return isoDate;
  return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

/** "Tue Nov 3" for a calendar date. */
export function dayLabel(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  if (!d) return isoDate;
  return `${WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()]} ${MONTHS[d.month - 1]} ${d.day}`;
}

/** "Nov 3" for a calendar date. */
export function monthDayOf(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  if (!d) return isoDate;
  return `${MONTHS[d.month - 1]} ${d.day}`;
}
