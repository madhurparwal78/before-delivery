const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, format);
  }
  return format;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/** Wall-clock parts of an instant in an IANA zone. `weekday` is 0 = Monday. */
export function localParts(instantMs: number, zone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const weekday = (new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!)).getUTCDay() + 6) % 7;
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
    weekday,
  };
}

function offsetAt(instantMs: number, zone: string): number {
  const p = localParts(Math.floor(instantMs / 1000) * 1000, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instantMs / 1000) * 1000;
}

/**
 * A wall time in a zone as an instant. A wall time inside the spring gap moves forward by the gap;
 * a wall time that occurs twice means its first occurrence.
 */
export function wallToInstant(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const before = offsetAt(asUtc - 86_400_000, zone);
  const after = offsetAt(asUtc + 86_400_000, zone);
  const candidates = [...new Set([asUtc - before, asUtc - after])].filter((instant) => {
    const p = localParts(instant, zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === asUtc;
  });
  if (candidates.length > 0) return Math.min(...candidates);
  return asUtc - before;
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localDateKey(instantMs: number, zone: string): string {
  const p = localParts(instantMs, zone);
  return dateKey(p.year, p.month, p.day);
}

export function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** `YYYY-MM-DD HH:mm` in a zone. */
export function formatLocal(instantMs: number, zone: string): string {
  const p = localParts(instantMs, zone);
  return `${dateKey(p.year, p.month, p.day)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** ISO 8601 instant with the zone's offset, for example 2026-11-04T00:00:00+01:00. */
export function isoWithOffset(instantMs: number, zone: string): string {
  const p = localParts(instantMs, zone);
  const offsetMinutes = Math.round(offsetAt(instantMs, zone) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${dateKey(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function isValidZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** An ISO instant as `YYYY-MM-DD HH:mm` on the wall clock of a zone. */
export function formatLocalIso(iso: string, zone: string): string {
  return formatLocal(Date.parse(iso), zone);
}

const LOCAL_TEXT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** Reads `YYYY-MM-DD HH:mm` on the wall clock of a zone as an ISO instant; null when the text is not in that form. */
export function localTextToIso(text: string, zone: string): string | null {
  const found = LOCAL_TEXT.exec(text.trim());
  if (!found) return null;
  const [year, month, day, hour, minute] = found.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(wallToInstant(year, month, day, hour, minute, zone)).toISOString();
}
