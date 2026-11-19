// Library time: converting between instants and the library's wall clock, in any IANA zone.

interface WallClock {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
}

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

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}

function wallParts(zone: string, instant: number): [number, number, number, number, number, number] {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return [parts.year!, parts.month!, parts.day!, parts.hour!, parts.minute!, parts.second!];
}

/** Minutes the zone is ahead of UTC at the instant. */
function offsetMinutes(zone: string, instant: number): number {
  const [y, mo, d, h, mi, s] = wallParts(zone, instant);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function wallClockOf(zone: string, instant: number): WallClock {
  const [y, mo, d, h, mi, s] = wallParts(zone, instant);
  return { date: `${pad(y, 4)}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${pad(mi)}:${pad(s)}` };
}

export function localDate(zone: string, instant: number): string {
  return wallClockOf(zone, instant).date;
}

/** Every instant at which the zone's wall clock reads date + time, earliest first (two when the clocks go back, none when they skip it). */
function wallClockInstants(zone: string, date: string, time: string): number[] {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split(":").map(Number) as [number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsets = new Set([offsetMinutes(zone, naive - 86_400_000), offsetMinutes(zone, naive + 86_400_000), offsetMinutes(zone, naive)]);
  const found = [...offsets]
    .map((offset) => naive - offset * 60_000)
    .filter((instant) => {
      const wall = wallClockOf(zone, instant);
      return wall.date === date && wall.time === time;
    });
  return [...new Set(found)].sort((a, b) => a - b);
}

/** The instant for a library wall-clock time: the first occurrence (or the second when asked), and the first instant after a skipped hour. */
export function wallClockInstant(zone: string, date: string, time: string, second: boolean): number {
  const instants = wallClockInstants(zone, date, time);
  if (instants.length > 0) return second ? instants[instants.length - 1]! : instants[0]!;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split(":").map(Number) as [number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  return naive - offsetMinutes(zone, naive - 86_400_000) * 60_000;
}

/** ISO 8601 with the zone's offset in force at that instant. */
export function formatInstant(zone: string, instant: number): string {
  const wall = wallClockOf(zone, instant);
  const offset = offsetMinutes(zone, instant);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const millis = instant % 1000 === 0 ? "" : `.${pad(((instant % 1000) + 1000) % 1000, 3)}`;
  return `${wall.date}T${wall.time}${millis}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Parses ISO 8601 that carries an offset or Z; null for anything else. */
export function parseInstant(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const m = ISO.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "00"].map(Number) as [number, number, number, number, number, number];
  const frac = m[7] ?? "";
  const zoneText = m[8]!;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  let offset = 0;
  if (zoneText !== "Z") {
    const digits = zoneText.replace(":", "");
    const sign = digits[0] === "-" ? -1 : 1;
    const oh = Number(digits.slice(1, 3));
    const om = Number(digits.slice(3, 5));
    if (oh > 23 || om > 59) return null;
    offset = sign * (oh * 60 + om);
  }
  const millis = frac ? Math.floor(Number(`0${frac}`) * 1000) : 0;
  return Date.UTC(y, mo - 1, d, h, mi, s, millis) - offset * 60_000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEK_ORDER: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function weekdayOf(date: string): Weekday {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}
