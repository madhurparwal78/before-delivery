// Markets, zones, Copenhagen calendar, go-live resolution and Night: decided here once and imported by both the
// server and the browser (the planner's dial computes with these same functions).

export const MARKETS = ["copenhagen", "stockholm", "paris", "london", "new_york", "tokyo"] as const;
export type Market = (typeof MARKETS)[number];

export const CITY: Record<Market, string> = {
  copenhagen: "Copenhagen",
  stockholm: "Stockholm",
  paris: "Paris",
  london: "London",
  new_york: "New York",
  tokyo: "Tokyo",
};

export const ZONE: Record<Market, string> = {
  copenhagen: "Europe/Copenhagen",
  stockholm: "Europe/Stockholm",
  paris: "Europe/Paris",
  london: "Europe/London",
  new_york: "America/New_York",
  tokyo: "Asia/Tokyo",
};

export const CURRENCY: Record<Market, string> = {
  copenhagen: "DKK",
  stockholm: "SEK",
  paris: "EUR",
  london: "GBP",
  new_york: "USD",
  tokyo: "JPY",
};

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

/** A wall-clock date and time without a zone. */
export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

/** The wall clock in `zone` at the instant `ms`. */
export function wallAt(ms: number, zone: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function wallAsUtc(wall: Wall): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

function offsetAt(ms: number, zone: string): number {
  return wallAsUtc(wallAt(ms, zone)) - Math.floor(ms / 1000) * 1000;
}

interface Resolved {
  /** The instant the wall time opens at. */
  ms: number;
  /** Minutes the wall time was pushed forward because the zone skips it (0 when it exists). */
  shiftMinutes: number;
}

/**
 * Resolve a wall time in a zone: an existing time maps to its first occurrence (a repeated autumn hour is on
 * summer time); a time inside a spring-forward gap opens shifted forward by the gap's length.
 */
export function resolveWall(wall: Wall, zone: string): Resolved {
  const naive = wallAsUtc(wall);
  const offsets = [...new Set([offsetAt(naive - 86_400_000, zone), offsetAt(naive, zone), offsetAt(naive + 86_400_000, zone)])];
  const fits = offsets.map((offset) => naive - offset).filter((ms) => wallAsUtc(wallAt(ms, zone)) === naive).sort((a, b) => a - b);
  if (fits.length) return { ms: fits[0], shiftMinutes: 0 };
  const before = offsetAt(naive - 86_400_000, zone);
  const after = offsetAt(naive + 86_400_000, zone);
  return { ms: naive - before, shiftMinutes: (after - before) / 60_000 };
}

export function isNight(wall: Pick<Wall, "hour">): boolean {
  return wall.hour >= 22 || wall.hour < 7;
}

// ---- parsing ----

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function validDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function parseDate(text: string): Pick<Wall, "year" | "month" | "day"> | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validDate(year, month, day) ? { year, month, day } : null;
}

export function parseLocal(text: string): Wall | null {
  const m = LOCAL_RE.exec(text);
  if (!m) return null;
  const wall = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0) };
  if (!validDate(wall.year, wall.month, wall.day) || wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null;
  return wall;
}

export function parseInstant(text: string): number | null {
  const m = INSTANT_RE.exec(text);
  if (!m) return null;
  const wall = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6]) };
  if (!validDate(wall.year, wall.month, wall.day) || wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null;
  return wallAsUtc(wall);
}

// ---- formatting of wall values ----

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function isoDate(wall: Pick<Wall, "year" | "month" | "day">): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function hhmm(wall: Pick<Wall, "hour" | "minute">): string {
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** `YYYY-MM-DDTHH:MM`, with seconds only when they are not zero. */
export function localText(wall: Wall): string {
  return `${isoDate(wall)}T${hhmm(wall)}${wall.second ? `:${pad(wall.second)}` : ""}`;
}

export function instantText(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function copenhagenWall(ms: number): Wall {
  return wallAt(ms, ZONE.copenhagen);
}

export function copenhagenToday(nowMs: number): Pick<Wall, "year" | "month" | "day"> {
  return copenhagenWall(nowMs);
}

export function addDays(date: Pick<Wall, "year" | "month" | "day">, days: number): Pick<Wall, "year" | "month" | "day"> {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** ISO week of a calendar date. */
export function isoWeek(date: Pick<Wall, "year" | "month" | "day">): { year: number; week: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday + 3);
  const year = d.getUTCFullYear();
  const week = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7);
  return { year, week };
}

export function weekValue(ms: number): string {
  const { year, week } = isoWeek(copenhagenWall(ms));
  return `${year}-W${pad(week)}`;
}

export function weekLabel(ms: number): string {
  const { year, week } = isoWeek(copenhagenWall(ms));
  return `Week ${week} · ${year}`;
}

// ---- go-live resolution ----

export type DropType = "simultaneous" | "rolling";

interface MarketOpening {
  market: Market;
  ms: number;
  shiftMinutes: number;
}

/** Each market's go-live instant for a rolling drop: the same wall time in every market's own zone. */
export function rollingOpenings(local: Wall): MarketOpening[] {
  return MARKETS.map((market) => {
    const { ms, shiftMinutes } = resolveWall(local, ZONE[market]);
    return { market, ms, shiftMinutes };
  });
}

/** A Copenhagen wall time for a simultaneous drop; null when Copenhagen skips it (the spring-forward gap). */
export function simultaneousInstant(local: Wall): number | null {
  const { ms, shiftMinutes } = resolveWall(local, ZONE.copenhagen);
  return shiftMinutes ? null : ms;
}
