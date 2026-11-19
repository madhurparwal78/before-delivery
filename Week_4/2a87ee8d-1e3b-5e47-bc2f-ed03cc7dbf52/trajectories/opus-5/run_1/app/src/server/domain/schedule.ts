const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallPartsOf(instantMs: number, timeZone: string): WallParts {
  const parts = partFormatter(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Time zone ${timeZone} produced no ${type} part`);
    return Number.parseInt(found.value, 10);
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset in milliseconds that the zone was at the given instant (local minus UTC). */
function zoneOffsetAt(instantMs: number, timeZone: string): number {
  const parts = wallPartsOf(instantMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function parseWallClock(value: string): WallClock | null {
  const match = WALL_CLOCK_PATTERN.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const year = Number.parseInt(y as string, 10);
  const month = Number.parseInt(mo as string, 10);
  const day = Number.parseInt(d as string, 10);
  const hour = Number.parseInt(h as string, 10);
  const minute = Number.parseInt(mi as string, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  // Reject a day that does not exist in the month, e.g. 2027-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

export type ResolvedWallClock =
  | { readonly kind: 'ok'; readonly instantMs: number }
  /** The wall-clock time falls in a spring-forward gap, so it does not exist. */
  | { readonly kind: 'gap' };

/**
 * The one place a wall-clock time in a facilitator's zone becomes an instant.
 * A time in a fall-back overlap resolves to the earlier instant.
 */
export function resolveWallClock(wall: WallClock, timeZone: string): ResolvedWallClock {
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  // Probe offsets a day either side so both sides of any transition are considered.
  const candidateOffsets = new Set<number>([
    zoneOffsetAt(naiveUtc - 86_400_000, timeZone),
    zoneOffsetAt(naiveUtc, timeZone),
    zoneOffsetAt(naiveUtc + 86_400_000, timeZone),
  ]);
  const valid: number[] = [];
  for (const offset of candidateOffsets) {
    const candidate = naiveUtc - offset;
    const parts = wallPartsOf(candidate, timeZone);
    if (
      parts.year === wall.year &&
      parts.month === wall.month &&
      parts.day === wall.day &&
      parts.hour === wall.hour &&
      parts.minute === wall.minute
    ) {
      valid.push(candidate);
    }
  }
  if (valid.length === 0) return { kind: 'gap' };
  // An overlap yields two instants; the earlier one is the summer-time offset.
  return { kind: 'ok', instantMs: Math.min(...valid) };
}

/** `YYYY-MM-DD` in the given zone. */
export function isoDateIn(instantMs: number, timeZone: string): string {
  const parts = wallPartsOf(instantMs, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Instant of the start of the local day that follows the given instant's local day. */
export function nextLocalMidnight(instantMs: number, timeZone: string): number {
  const parts = wallPartsOf(instantMs, timeZone);
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const day = { year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() };
  // A zone whose clocks jump at midnight leaves 00:00 in a gap; the day then starts at the first minute that exists.
  for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += 1) {
    const resolved = resolveWallClock(
      { ...day, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 },
      timeZone,
    );
    if (resolved.kind === 'ok') return resolved.instantMs;
  }
  throw new Error(`Could not find the start of the next local day in ${timeZone}`);
}

/** ISO 8601 UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export function isoTimestamp(instantMs: number): string {
  return new Date(instantMs).toISOString();
}
