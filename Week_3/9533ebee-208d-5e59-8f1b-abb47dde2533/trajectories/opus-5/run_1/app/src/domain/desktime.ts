/**
 * Desk wall times and canonical UTC instants: the single place where an
 * instant becomes desk-zone text and where desk-zone text becomes an instant.
 */

interface WallParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  const cached = partsFormatters.get(zone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  partsFormatters.set(zone, made);
  return made;
}

function wallPartsAt(instantMs: number, zone: string): WallParts {
  const parts = partsFormatter(zone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function wallAsUtcMs(parts: WallParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** The zone's offset from UTC in milliseconds at a given instant. */
function offsetMsAt(instantMs: number, zone: string): number {
  return wallAsUtcMs(wallPartsAt(instantMs, zone)) - instantMs;
}

/** Locales to ask for a short zone name, in order of preference. */
const ABBREVIATION_LOCALES = ['en-CA', 'en-US', 'en-GB'];

const abbreviationFormatters = new Map<string, Intl.DateTimeFormat>();

function abbreviationFormatter(zone: string, locale: string): Intl.DateTimeFormat {
  const cacheKey = `${zone}|${locale}`;
  const cached = abbreviationFormatters.get(cacheKey);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
  abbreviationFormatters.set(cacheKey, made);
  return made;
}

/**
 * The zone's abbreviation for that instant, as the tz database gives it: `NST`
 * or `NDT` for Newfoundland time. Zones that only have an offset name fall
 * back to that offset.
 */
export function zoneAbbreviation(instantMs: number, zone: string): string {
  let offsetName = '';
  for (const locale of ABBREVIATION_LOCALES) {
    const parts = abbreviationFormatter(zone, locale).formatToParts(new Date(instantMs));
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (name === '') continue;
    if (!name.startsWith('GMT') && !name.startsWith('UTC')) return name;
    if (offsetName === '') offsetName = name;
  }
  return offsetName;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** A desk wall time as `HH:MM:SS <abbr>`. */
export function formatWallTime(instantMs: number, zone: string): string {
  const parts = wallPartsAt(instantMs, zone);
  return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)} ${zoneAbbreviation(instantMs, zone)}`;
}

/** A desk wall time as `YYYY-MM-DD HH:MM:SS <abbr>`, for the ledger and statements. */
export function formatWallDateTime(instantMs: number, zone: string): string {
  const parts = wallPartsAt(instantMs, zone);
  const date = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  const time = `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`;
  return `${date} ${time} ${zoneAbbreviation(instantMs, zone)}`;
}

/** The one canonical UTC output form: `YYYY-MM-DDTHH:MM:SSZ`, whole seconds. */
export function formatCanonicalUtc(instantMs: number): string {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return `${new Date(whole).toISOString().slice(0, 19)}Z`;
}

export type DeskTimeProblem = 'shape' | 'gap';

export type DeskTimeResult =
  { ok: true; instantMs: number } | { ok: false; problem: DeskTimeProblem };

const DESK_TIME_SHAPE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * Reads `YYYY-MM-DD HH:MM` as a desk wall time. A time inside a
 * daylight-saving gap is refused. A time inside a fold resolves to the earlier
 * of its two instants, which is the daylight reading.
 */
export function parseDeskWallTime(text: string, zone: string): DeskTimeResult {
  const match = DESK_TIME_SHAPE.exec(text.trim());
  if (match === null) return { ok: false, problem: 'shape' };
  const [, year, month, day, hour, minute] = match;
  const wanted: WallParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: 0,
  };
  if (wanted.month < 1 || wanted.month > 12) return { ok: false, problem: 'shape' };
  if (wanted.day < 1 || wanted.day > 31) return { ok: false, problem: 'shape' };
  if (wanted.hour > 23 || wanted.minute > 59) return { ok: false, problem: 'shape' };

  const naive = wallAsUtcMs(wanted);
  const naiveDate = new Date(naive);
  if (naiveDate.getUTCMonth() + 1 !== wanted.month || naiveDate.getUTCDate() !== wanted.day) {
    return { ok: false, problem: 'shape' };
  }

  const dayMs = 86400000;
  const guesses = new Set<number>([
    offsetMsAt(naive - dayMs, zone),
    offsetMsAt(naive, zone),
    offsetMsAt(naive + dayMs, zone),
  ]);

  const candidates = new Set<number>();
  for (const guess of guesses) {
    const candidate = naive - guess;
    const round = wallPartsAt(candidate, zone);
    if (
      round.year === wanted.year &&
      round.month === wanted.month &&
      round.day === wanted.day &&
      round.hour === wanted.hour &&
      round.minute === wanted.minute
    ) {
      candidates.add(candidate);
    }
  }

  if (candidates.size === 0) return { ok: false, problem: 'gap' };
  return { ok: true, instantMs: Math.min(...candidates) };
}

/**
 * Reads an RFC 3339 instant with a mandatory `Z` or `±HH:MM` offset.
 * Fractional seconds are allowed and are dropped.
 */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function parseRfc3339(text: string): number | null {
  const match = RFC3339.exec(text.trim());
  if (match === null) return null;
  const parsed = Date.parse(text.trim());
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000) * 1000;
}

/** True when the text is exactly the canonical UTC output form. */
export function isCanonicalUtc(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) && !Number.isNaN(Date.parse(text));
}
