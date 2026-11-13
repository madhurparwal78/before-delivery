// Time zone arithmetic shared by the server (buckets, maintenance windows) and the browser (time picker, display).
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function isKnownZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

export function wallTimeAt(zone: string, instantMs: number): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function wallAsUtc(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Offset of the zone from UTC at an instant, in minutes. */
export function offsetMinutesAt(zone: string, instantMs: number): number {
  const wholeSecond = Math.floor(instantMs / 1000) * 1000;
  return Math.round((wallAsUtc(wallTimeAt(zone, wholeSecond)) - wholeSecond) / MINUTE_MS);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** The published display format: `YYYY-MM-DD HH:MM:SS +HH:MM`. */
export function formatDisplay(instantMs: number, zone: string): string {
  const wall = wallTimeAt(zone, instantMs);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)} ${formatOffset(offsetMinutesAt(zone, instantMs))}`;
}

/** Instants whose wall time in the zone is exactly `wall`: none in a gap, two in a fold, earliest first. */
export function instantsForWall(zone: string, wall: WallTime): number[] {
  const asUtc = wallAsUtc(wall);
  const offsets = new Set([offsetMinutesAt(zone, asUtc - DAY_MS), offsetMinutesAt(zone, asUtc + DAY_MS)]);
  const found: number[] = [];
  for (const offset of offsets) {
    const candidate = asUtc - offset * MINUTE_MS;
    if (offsetMinutesAt(zone, candidate) === offset) found.push(candidate);
  }
  return found.sort((a, b) => a - b);
}

/** A wall time as one instant: a fold takes the earlier one, a gap lands the same distance after it (02:30 becomes 03:30). */
export function resolveWall(zone: string, wall: WallTime): number {
  const [first] = instantsForWall(zone, wall);
  if (first !== undefined) return first;
  const asUtc = wallAsUtc(wall);
  return asUtc - offsetMinutesAt(zone, asUtc - DAY_MS) * MINUTE_MS;
}

function midnightWall(year: number, month: number, day: number): WallTime {
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

export function startOfLocalDay(zone: string, instantMs: number): number {
  const wall = wallTimeAt(zone, instantMs);
  return resolveWall(zone, midnightWall(wall.year, wall.month, wall.day));
}

/** Local midnight `days` calendar days after the local day holding the instant. */
export function addLocalDays(zone: string, instantMs: number, days: number): number {
  const wall = wallTimeAt(zone, instantMs);
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return resolveWall(zone, midnightWall(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()));
}

/** Day of week of the local day holding the instant: 0 is Monday. */
export function localWeekday(zone: string, instantMs: number): number {
  const wall = wallTimeAt(zone, instantMs);
  return (new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() + 6) % 7;
}

export function sameLocalDay(zone: string, firstMs: number, secondMs: number): boolean {
  const a = wallTimeAt(zone, firstMs);
  const b = wallTimeAt(zone, secondMs);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
