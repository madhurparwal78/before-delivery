export const TOWNS = ['amsterdam', 'newYork', 'toronto', 'dubai'] as const;
export type Town = (typeof TOWNS)[number];

export const PLACES = ['netherlands', 'ontario', 'newYork', 'dubai'] as const;
export type Place = (typeof PLACES)[number];

export const LICENCE_MARKETS = ['NL', 'US', 'CA', 'AE'] as const;
export type LicenceMarket = (typeof LICENCE_MARKETS)[number];

const ZONES: Record<Town, string> = {
  amsterdam: 'Europe/Amsterdam',
  newYork: 'America/New_York',
  toronto: 'America/Toronto',
  dubai: 'Asia/Dubai',
};

const TOWN_LABELS: Record<Town, string> = {
  amsterdam: 'Amsterdam',
  newYork: 'New York',
  toronto: 'Toronto',
  dubai: 'Dubai',
};

const MARKET_TOWNS: Record<LicenceMarket, Town> = {
  NL: 'amsterdam',
  US: 'newYork',
  CA: 'toronto',
  AE: 'dubai',
};

const PLACE_TOWNS: Record<Place, Town> = {
  netherlands: 'amsterdam',
  ontario: 'toronto',
  newYork: 'newYork',
  dubai: 'dubai',
};

export function townLabel(town: Town): string {
  return TOWN_LABELS[town];
}

export function marketTown(market: LicenceMarket): Town {
  return MARKET_TOWNS[market];
}

export function placeTown(place: Place): Town {
  return PLACE_TOWNS[place];
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    PART_FORMATTERS.set(zone, formatter);
  }
  return formatter;
}

export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The wall time an instant reads as in a town. */
export function wallTimeIn(instant: Date, town: Town): WallTime {
  const parts = partFormatter(ZONES[town]).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: WEEKDAYS.indexOf(read('weekday') as (typeof WEEKDAYS)[number]),
  };
}

function offsetMsAt(instant: number, town: Town): number {
  const wall = wallTimeIn(new Date(instant), town);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export type WallResolution =
  | { kind: 'ok'; instant: Date }
  | { kind: 'skipped' }
  | { kind: 'twice'; instant: Date };

/**
 * The instant a local wall time names in a town. A time the clock change skips
 * has no instant; one that happens twice takes the first of the two.
 */
export function resolveWallTime(
  town: Town,
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
): WallResolution {
  const wantedUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  const candidates = new Set<number>();
  for (const probe of [wantedUtc - 86400000, wantedUtc, wantedUtc + 86400000]) {
    candidates.add(wantedUtc - offsetMsAt(probe, town));
  }
  const matching = [...candidates]
    .filter((candidate) => {
      const wall = wallTimeIn(new Date(candidate), town);
      return (
        wall.year === date.year &&
        wall.month === date.month &&
        wall.day === date.day &&
        wall.hour === time.hour &&
        wall.minute === time.minute
      );
    })
    .sort((a, b) => a - b);
  const first = matching[0];
  if (first === undefined) return { kind: 'skipped' };
  if (matching.length > 1) return { kind: 'twice', instant: new Date(first) };
  return { kind: 'ok', instant: new Date(first) };
}

/** `2027-03-15` on the local date of a town. */
export function isoDateIn(instant: Date, town: Town): string {
  const wall = wallTimeIn(instant, town);
  return `${String(wall.year).padStart(4, '0')}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** `Mon 29 Mar 2027` on the local date of a town. */
export function longDateIn(instant: Date, town: Town): string {
  const wall = wallTimeIn(instant, town);
  return `${WEEKDAYS[wall.weekday]} ${wall.day} ${MONTHS[wall.month - 1]} ${wall.year}`;
}

/** `Mon 29 Mar 2027` from an iso date, read as a plain calendar date. */
export function longDateFromIso(iso: string): string {
  const parts = splitIsoDate(iso);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** 24-hour `HH:mm` of the minute of an instant in a town. */
export function clockTimeIn(instant: Date, town: Town): string {
  const wall = wallTimeIn(instant, town);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** A time after which a person may try again, rounded up to the next whole minute. */
export function clockTimeInRoundedUp(instant: Date, town: Town): string {
  const rounded = new Date(Math.ceil(instant.getTime() / 60000) * 60000);
  return clockTimeIn(rounded, town);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function splitIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year = '0', month = '1', day = '1'] = iso.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = splitIsoDate(value);
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    probe.getUTCFullYear() === parts.year &&
    probe.getUTCMonth() + 1 === parts.month &&
    probe.getUTCDate() === parts.day
  );
}

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Whole days from one calendar date to another. */
export function daysBetweenIso(from: string, to: string): number {
  const a = splitIsoDate(from);
  const b = splitIsoDate(to);
  const left = Date.UTC(a.year, a.month - 1, a.day);
  const right = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((right - left) / 86400000);
}

export function addDaysIso(iso: string, days: number): string {
  const parts = splitIsoDate(iso);
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * 86400000);
  return `${String(moved.getUTCFullYear()).padStart(4, '0')}-${pad(
    moved.getUTCMonth() + 1,
  )}-${pad(moved.getUTCDate())}`;
}

/** The Monday of the week an iso date falls in. */
export function mondayOfIso(iso: string): string {
  const parts = splitIsoDate(iso);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return addDaysIso(iso, weekday === 0 ? -6 : 1 - weekday);
}

/** Every instant in whole seconds with a Z, never milliseconds. */
export function toInstantText(instant: Date): string {
  return `${new Date(Math.floor(instant.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

/** The end of a local day: 23:59:59 wall time in a town on an iso date. */
export function endOfDayIn(iso: string, town: Town): Date {
  const parts = splitIsoDate(iso);
  const resolved = resolveWallTime(town, parts, { hour: 23, minute: 59 });
  const base = resolved.kind === 'skipped' ? Date.UTC(parts.year, parts.month - 1, parts.day) : resolved.instant.getTime();
  return new Date(base + 59000);
}

/** The next instant at which a town's offset changes, searched forward by hours. */
export function nextClockChange(from: Date, towns: readonly Town[]): Date {
  const step = 3600000;
  let probe = Math.floor(from.getTime() / step) * step;
  const limit = probe + 400 * 24 * step;
  let current = towns.map((town) => offsetMsAt(probe, town));
  while (probe < limit) {
    probe += step;
    const next = towns.map((town) => offsetMsAt(probe, town));
    if (next.some((offset, index) => offset !== current[index])) return new Date(probe);
    current = next;
  }
  return new Date(limit);
}
