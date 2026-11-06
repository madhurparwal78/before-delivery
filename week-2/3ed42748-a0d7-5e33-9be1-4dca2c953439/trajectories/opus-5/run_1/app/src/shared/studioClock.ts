/** Zone names that are always accepted, however Node's own list spells them. */
const ALWAYS_ACCEPTED = [
  'UTC',
  'America/Vancouver',
  'America/St_Johns',
  'Europe/London',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Adelaide',
  'Australia/Eucla',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
];

let accepted: Set<string> | null = null;

/** The accepted studio time zone names, matched letter case and all. */
export function acceptedTimeZones(): Set<string> {
  if (!accepted) {
    accepted = new Set([...Intl.supportedValuesOf('timeZone'), ...ALWAYS_ACCEPTED]);
  }
  return accepted;
}

export function sortedTimeZones(): string[] {
  return [...acceptedTimeZones()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function isAcceptedTimeZone(value: unknown): value is string {
  return typeof value === 'string' && acceptedTimeZones().has(value);
}

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
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
      era: 'short',
    });
    formatters.set(zone, found);
  }
  return found;
}

/** The local wall-clock reading of an instant in a zone. */
export function wallParts(instant: Date, zone: string): WallParts {
  const parts = formatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const era = parts.find((part) => part.type === 'era')?.value;
  const year = read('year') * (era === 'BC' ? -1 : 1);
  return {
    year,
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
    millisecond: instant.getUTCMilliseconds(),
  };
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

function civilMillis(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** The instant read as if its local wall clock were UTC, to the second. */
function localMillis(instant: Date, zone: string): number {
  return civilMillis(wallParts(instant, zone));
}

function zoneOffsetMs(instant: Date, zone: string): number {
  return localMillis(instant, zone) - Math.floor(instant.getTime() / 1000) * 1000;
}

export function formatWallTime(instant: Date, zone: string): string {
  const parts = wallParts(instant, zone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatBoardDate(parts: Pick<WallParts, 'year' | 'month' | 'day'>): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

function previousDay(parts: Pick<WallParts, 'year' | 'month' | 'day'>): WallParts {
  const stepped = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  stepped.setUTCDate(stepped.getUTCDate() - 1);
  return {
    year: stepped.getUTCFullYear(),
    month: stepped.getUTCMonth() + 1,
    day: stepped.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };
}

/** The board day an instant falls in: each day starts at four in the morning, local time. */
export function boardDateFor(instant: Date, zone: string): string {
  const parts = wallParts(instant, zone);
  if (parts.hour >= 4) return formatBoardDate(parts);
  return formatBoardDate(previousDay(parts));
}

const WALL_TIME_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export type WallTimeFault = 'invalid' | 'nonexistent_time';

/**
 * Resolves a studio wall time to its instant. A time the clocks skip has no instant; a time that
 * happens twice resolves to the earlier one.
 */
export function resolveWallTime(
  raw: string,
  zone: string,
): { instant: Date } | { fault: WallTimeFault } {
  const match = WALL_TIME_SHAPE.exec(raw);
  if (!match) return { fault: 'invalid' };
  const [, year, month, day, hour, minute] = match as unknown as string[];
  const parts: WallParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: 0,
    millisecond: 0,
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    return { fault: 'invalid' };
  }
  if (parts.hour > 23 || parts.minute > 59) return { fault: 'invalid' };
  const target = civilMillis(parts);
  const roundTrip = new Date(target);
  if (
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day
  ) {
    return { fault: 'invalid' };
  }
  const probes = [target - 86_400_000, target, target + 86_400_000];
  const candidates = new Set<number>();
  for (const probe of probes) {
    const offset = zoneOffsetMs(new Date(probe), zone);
    const candidate = target - offset;
    if (localMillis(new Date(candidate), zone) === target) candidates.add(candidate);
  }
  if (candidates.size === 0) return { fault: 'nonexistent_time' };
  return { instant: new Date(Math.min(...candidates)) };
}
