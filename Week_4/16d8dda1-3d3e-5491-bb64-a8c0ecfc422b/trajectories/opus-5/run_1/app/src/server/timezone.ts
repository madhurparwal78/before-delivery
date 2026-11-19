const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  formatters.set(timeZone, created);
  return created;
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** An IANA zone name the platform's time zone database knows, such as `Europe/London` or `UTC`. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z0-9+_\-/]+$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function wallAt(timeZone: string, instant: Date): WallTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  };
}

function wallToMillis(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** The zone's offset in milliseconds at a given instant. */
function offsetAt(timeZone: string, instant: Date): number {
  return wallToMillis(wallAt(timeZone, instant)) - instant.getTime();
}

export const wallPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseWallTime(text: string): WallTime | null {
  const match = wallPattern.exec(text.trim());
  if (!match) return null;
  const wall: WallTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6])
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null;
  const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (probe.getUTCMonth() !== wall.month - 1 || probe.getUTCDate() !== wall.day) return null;
  return wall;
}

/**
 * The instant a wall time names in a zone. A time skipped by a daylight-saving
 * change has none; a time that happens twice takes its first occurrence.
 */
export function wallTimeToInstant(timeZone: string, wall: WallTime): Date | null {
  const target = wallToMillis(wall);
  const candidates = new Set<number>();
  for (const guess of [target, target - 86_400_000, target + 86_400_000]) {
    const offset = offsetAt(timeZone, new Date(guess));
    candidates.add(target - offset);
  }
  const valid = [...candidates]
    .filter((millis) => wallToMillis(wallAt(timeZone, new Date(millis))) === target)
    .sort((a, b) => a - b);
  const first = valid[0];
  return first === undefined ? null : new Date(first);
}

export function formatWallTime(wall: WallTime): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
}

export function formatWall(timeZone: string, instant: Date): string {
  return formatWallTime(wallAt(timeZone, instant));
}

export function toUtcIso(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}
