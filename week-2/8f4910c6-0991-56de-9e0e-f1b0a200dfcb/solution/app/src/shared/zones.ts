// Calendar dates, office zones and local-time ↔ instant conversion with IANA rules.

export type OfficeId = "toronto" | "vancouver";

export const OFFICES: Record<OfficeId, { city: string; timeZone: string }> = {
  toronto: { city: "Toronto", timeZone: "America/Toronto" },
  vancouver: { city: "Vancouver", timeZone: "America/Vancouver" },
};

export const OFFICE_IDS: OfficeId[] = ["toronto", "vancouver"];

export function isOfficeId(value: unknown): value is OfficeId {
  return value === "toronto" || value === "vancouver";
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(zone, formatter);
  }
  return formatter;
}

export function isValidZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock of `zone` at the instant `ms`. */
export function zonedParts(ms: number, zone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
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

function wallMs(p: LocalParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetAt(ms: number, zone: string): number {
  return wallMs(zonedParts(ms, zone)) - Math.floor(ms / 1000) * 1000;
}

export type Resolved = { kind: "instant"; ms: number } | { kind: "gap" };

/**
 * The instant a wall-clock time names in `zone`. A time skipped by a spring-forward change is a gap;
 * a time repeated by an autumn change resolves to its first occurrence.
 */
export function localToInstant(local: LocalParts, zone: string): Resolved {
  const wall = wallMs(local);
  const day = 86_400_000;
  const offsets = new Set([offsetAt(wall - day, zone), offsetAt(wall, zone), offsetAt(wall + day, zone)]);
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => wallMs(zonedParts(candidate, zone)) === wall)
    .sort((a, b) => a - b);
  return matches.length ? { kind: "instant", ms: matches[0] } : { kind: "gap" };
}

/** The first instant of the calendar day `iso` in `zone`. */
export function startOfLocalDay(iso: string, zone: string): number {
  const { year, month, day } = parseIsoDate(iso);
  for (let hour = 0; hour < 24; hour++) {
    const resolved = localToInstant({ year, month, day, hour, minute: 0, second: 0 }, zone);
    if (resolved.kind === "instant") return resolved.ms;
  }
  throw new RangeError(`no instant for ${iso} in ${zone}`);
}

export function localDateOf(ms: number, zone: string): string {
  const p = zonedParts(ms, zone);
  return isoDate(p.year, p.month, p.day);
}

export function officeToday(office: OfficeId, now = Date.now()): string {
  return localDateOf(now, OFFICES[office].timeZone);
}

// ISO calendar dates ("YYYY-MM-DD") as plain values.

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseIsoDate(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** `iso` plus whole months, clamped to the target month's last day. */
export function addMonths(iso: string, months: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return isoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonthsToMonth(month: string, delta: number): string {
  return addMonths(`${month}-01`, delta).slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return isoDate(year, m, daysInMonth(year, m));
}
