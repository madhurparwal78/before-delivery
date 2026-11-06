// Business time in the practice zone: the one place that turns a barn day's wall-clock date and start time
// into instants, derives the cancellation cutoff, and prints instants with the offset in force (brief: Practice time).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface WallClock {
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

function wallClockAt(instant: number, zone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function asUtc(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const whole = instant - (instant % 1000);
  return asUtc(wallClockAt(whole, zone)) - whole;
}

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, "0");

/** `YYYY-MM-DDTHH:MM:SS±HH:MM` with the practice-zone offset in force at the instant. */
export function formatInstant(instant: number, zone: string): string {
  const wall = wallClockAt(instant, zone);
  const offsetMinutes = Math.round(offsetAt(instant, zone) / MINUTE);
  const sign = offsetMinutes < 0 ? "-" : "+";
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`
  );
}

/** `YYYY-MM-DD HH:MM (<zone>)`, the cutoff / expiry copy format. */
export function formatWallClock(instant: number, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)} (${zone})`;
}

/** Today's business date in the practice zone. */
export function businessDate(instant: number, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The instant at which the zone's clock reads `date time`. A time skipped by a forward clock change has no
 * instant (null); a time repeated by a backward change resolves to its earlier occurrence.
 */
export function wallClockInstant(date: string, time: string, zone: string): number | null {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall: WallClock = { year: y ?? 0, month: mo ?? 0, day: d ?? 0, hour: h ?? 0, minute: mi ?? 0, second: 0 };
  const naive = asUtc(wall);
  const offsets = new Set([offsetAt(naive - DAY, zone), offsetAt(naive, zone), offsetAt(naive + DAY, zone)]);
  const matches = [...offsets].map((offset) => naive - offset).filter((instant) => asUtc(wallClockAt(instant, zone)) === naive);
  return matches.length ? Math.min(...matches) : null;
}

/** The cancellation cutoff: exactly 24 elapsed hours before the start instant. */
export function cancellationCutoff(startsAt: number): number {
  return startsAt - DAY;
}

/** Clock time `HH:MM` that is `minutes` after `time`, wrapping past midnight. */
export function clockPlus(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = ((((h ?? 0) * 60 + (m ?? 0) + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidClockTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
