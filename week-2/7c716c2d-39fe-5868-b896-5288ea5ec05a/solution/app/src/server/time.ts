// Dates and instants in a workspace zone. The server's now is the process clock (Date.now()),
// shifted so that it equals SERVER_CLOCK_START at the moment the process started, when that is set.
import { config } from "./config.js";

export type IsoDate = string; // YYYY-MM-DD

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
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

export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}

const clockShift = config.clockStart === null ? 0 : Date.parse(config.clockStart) - Date.now();

/** Whole-second "now", so stored instants and their published form agree exactly. */
export function nowMs(): number {
  return Math.floor((Date.now() + clockShift) / 1000) * 1000;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wall(ms: number, zone: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of `zone` from UTC at instant `ms`, in minutes. */
function offsetMinutes(ms: number, zone: string): number {
  const w = wall(ms, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function localDate(ms: number, zone: string): IsoDate {
  const w = wall(ms, zone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** ISO 8601 with the zone's offset at that instant, e.g. 2026-10-19T00:00:00+13:00. */
export function isoInstant(ms: number, zone: string): string {
  const w = wall(ms, zone);
  const offset = offsetMinutes(ms, zone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const DAY_MS = 86_400_000;

/** The instant of local wall time `hour`:00 on `date` in `zone`. A wall time that happens twice
 * is its earlier instance; one that does not exist is the first instant after the gap. */
export function localTime(date: IsoDate, hour: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, hour, 0, 0);
  const before = target - offsetMinutes(target - DAY_MS, zone) * 60000;
  const after = target - offsetMinutes(target + DAY_MS, zone) * 60000;
  const fits = (ms: number): boolean => ms + offsetMinutes(ms, zone) * 60000 === target;
  const valid = [before, after].filter(fits);
  if (valid.length > 0) return Math.min(...valid);
  let low = Math.min(before, after);
  let high = Math.max(before, after);
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (offsetMinutes(middle, zone) === offsetMinutes(low, zone)) low = middle;
    else high = middle;
  }
  return high;
}

/** Compares the zone's offset just before `date` begins with its offset at the end of `date`. */
export function clockChange(date: IsoDate, zone: string): "forward" | "back" | null {
  const opening = offsetMinutes(localMidnight(date, zone) - 1000, zone);
  const closing = offsetMinutes(localMidnight(addDays(date, 1), zone) - 1000, zone);
  if (closing === opening) return null;
  return closing > opening ? "forward" : "back";
}

export function localMidnight(date: IsoDate, zone: string): number {
  return localTime(date, 0, zone);
}

export function isRealDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday 1 (Monday) to 7 (Sunday). */
export function isoWeekday(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Friday 30 October", as in the digest subject. */
export function longDate(date: IsoDate): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[isoWeekday(date) - 1]} ${d} ${MONTHS[m - 1]}`;
}
