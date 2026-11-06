const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
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

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallOf(zone: string, instant: number): Wall {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const pick = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

function wallAsUtc(wall: Wall): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** The zone's UTC offset in milliseconds at an instant. */
export function offsetAt(zone: string, instant: number): number {
  return wallAsUtc(wallOf(zone, instant)) - Math.floor(instant / 1000) * 1000;
}

export function dateInZone(zone: string, instant: number): string {
  const wall = wallOf(zone, instant);
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

/**
 * The instant of a local wall time on a date. When that time is skipped by a
 * forward clock change the first instant after the gap is used; when it happens
 * twice the earlier instance is used.
 */
export function localWallTime(zone: string, date: string, hour: number): number {
  const wallUtc = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  const firstOffset = offsetAt(zone, wallUtc);
  const firstCandidate = wallUtc - firstOffset;
  const secondOffset = offsetAt(zone, firstCandidate);
  if (secondOffset === firstOffset) return firstCandidate;
  const secondCandidate = wallUtc - secondOffset;
  const valid = [firstCandidate, secondCandidate].filter(
    (candidate) => offsetAt(zone, candidate) === wallUtc - candidate,
  );
  if (valid.length === 0) return Math.max(firstCandidate, secondCandidate);
  return Math.min(...valid);
}

export function localMidnight(zone: string, date: string): number {
  return localWallTime(zone, date, 0);
}

/** The ISO 8601 instant with the zone's offset at that instant, as the API prints it. */
export function instantWithOffset(zone: string, instant: number): string {
  const offset = offsetAt(zone, instant);
  const wall = wallOf(zone, instant);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const hours = Math.floor(absolute / 3600000);
  const minutes = Math.floor((absolute % 3600000) / 60000);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(hours)}:${pad(minutes)}`
  );
}

/** A stored timestamp as the API prints it: ISO 8601 with the workspace's offset. */
export function storedInstant(zone: string, stored: string | null): string | null {
  if (stored === null) return null;
  const parsed = Date.parse(stored.includes('T') ? stored : stored.replace(' ', 'T'));
  if (Number.isNaN(parsed)) return null;
  return instantWithOffset(zone, parsed);
}

export function addDays(date: string, count: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  const moved = new Date(base + count * 86400000);
  return moved.toISOString().slice(0, 10);
}

/** ISO weekday, 1 for Monday through 7 for Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
