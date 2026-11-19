// Class time zones: wall times in a class's zone, and their instants.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, found);
  }
  return found;
}

const LISTED = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);
// An IANA zone name: UTC, a listed zone, or an Area/Location name Intl knows (aliases such as Asia/Calcutta).
// Offsets ("+05:00", "-0600") and abbreviations ("CST", "GMT+2") are not zone names, though Intl accepts some.
const AREA_NAME = /^[A-Za-z][A-Za-z_-]*(\/[A-Za-z0-9][A-Za-z0-9_+-]*)+$/;

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.includes('\u0000')) return false;
  if (!LISTED.has(value) && !AREA_NAME.test(value)) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallOf(instantMs: number, zone: string): Wall {
  const wall: Wall = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const { type, value } of formatterFor(zone).formatToParts(new Date(instantMs))) {
    if (type === 'year' || type === 'month' || type === 'day' || type === 'hour' || type === 'minute' || type === 'second') wall[type] = Number(value);
  }
  return wall;
}

function offsetMs(instantMs: number, zone: string): number {
  const wall = wallOf(instantMs, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Reads `YYYY-MM-DDTHH:MM` with optional `:SS`; null when badly formed or not a real date. */
export function parseWall(text: unknown): Wall | null {
  if (typeof text !== 'string') return null;
  const match = WALL_TIME.exec(text);
  if (!match) return null;
  const wall: Wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
  const real =
    check.getUTCFullYear() === wall.year &&
    check.getUTCMonth() === wall.month - 1 &&
    check.getUTCDate() === wall.day &&
    check.getUTCHours() === wall.hour &&
    check.getUTCMinutes() === wall.minute &&
    check.getUTCSeconds() === wall.second;
  return real ? wall : null;
}

/** The instant of a wall time in a zone: the first one when it happens twice, null when it is skipped. */
export function wallToInstant(wall: Wall, zone: string): number | null {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const day = 24 * 3600 * 1000;
  const offsets = new Set([offsetMs(asUtc - day, zone), offsetMs(asUtc + day, zone)]);
  const instants = [...offsets].map((offset) => asUtc - offset).filter((instant) => offsetMs(instant, zone) === asUtc - instant);
  return instants.length === 0 ? null : Math.min(...instants);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `YYYY-MM-DDTHH:MM:SS` in the zone. */
export function instantToWall(instantMs: number, zone: string): string {
  const wall = wallOf(instantMs, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
}
