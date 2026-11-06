// Business time: Split (Europe/Zagreb) and Lavrio (Europe/Athens). Every conversion between a base's
// local date and time and an instant happens here.

export type Base = "split" | "lavrio";

const ZONES: Record<Base, string> = { split: "Europe/Zagreb", lavrio: "Europe/Athens" };
export const BASE_NAMES: Record<Base, string> = { split: "Split", lavrio: "Lavrio" };

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
    found = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function localParts(instantMs: number, base: Base): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(ZONES[base]).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The base-local calendar date of an instant, `YYYY-MM-DD`. */
export function localDate(instantMs: number, base: Base): string {
  return isoDate(localParts(instantMs, base));
}

/** The base-local `HH:MM` of an instant. */
export function localClock(instantMs: number, base: Base): string {
  const parts = localParts(instantMs, base);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * The instant of a base-local date and time. A time inside the spring-forward gap gives null; a time that
 * repeats in autumn gives its first occurrence.
 */
export function localToInstant(date: string, time: string, base: Base): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set<number>();
  for (const probe of [naive - 14 * 3600_000, naive, naive + 14 * 3600_000]) {
    const p = localParts(probe, base);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - probe;
    candidates.add(naive - offset);
  }
  const matching = [...candidates]
    .filter((instant) => {
      const p = localParts(instant, base);
      return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
    })
    .sort((a, b) => a - b);
  return matching.length ? matching[0] : null;
}

/** Local midnight at the start of a base-local date (midnight always exists in both bases). */
export function startOfLocalDay(date: string, base: Base): number {
  const instant = localToInstant(date, "00:00", base);
  if (instant === null) throw new RangeError(`no midnight on ${date}`);
  return instant;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** An instant in the API's format: whole seconds and a Z. */
export function isoInstant(instantMs: number): string {
  return new Date(Math.floor(instantMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}
