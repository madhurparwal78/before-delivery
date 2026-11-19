import { CivilDate, pad } from '../../shared/dates';

export const PRACTICE_ZONE = 'America/Chicago';

const ZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific',
  'Pacific/Honolulu': 'Hawaii',
};

export function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone;
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

export function partsInZone(zone: string, instantMs: number): ZonedParts {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    y: read('year'),
    m: read('month'),
    d: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
    ms: ((instantMs % 1000) + 1000) % 1000,
  };
}

/** The zone's UTC offset in milliseconds at the given instant. */
export function zoneOffsetMs(zone: string, instantMs: number): number {
  const p = partsInZone(zone, instantMs);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second, p.ms);
  return asIfUtc - instantMs;
}

/** The UTC instant of a wall-clock time in a zone. */
export function zonedToInstant(
  zone: string,
  date: CivilDate,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): number {
  const target = Date.UTC(date.y, date.m - 1, date.d, hour, minute, second, ms);
  let guess = target - zoneOffsetMs(zone, target);
  guess = target - zoneOffsetMs(zone, guess);
  return guess;
}

/** The last millisecond of a date in a zone. */
export function endOfDayInstant(zone: string, date: CivilDate): number {
  return zonedToInstant(zone, date, 23, 59, 59, 999);
}

/** `11:59 pm` from a zoned instant, dropping seconds. */
export function clockLabel(zone: string, instantMs: number): string {
  const p = partsInZone(zone, instantMs);
  const suffix = p.hour < 12 ? 'am' : 'pm';
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${pad(p.minute, 2)} ${suffix}`;
}

export function toInstantString(instantMs: number): string {
  return new Date(instantMs).toISOString().replace(/\.(\d{3})Z$/, '.$1Z');
}

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isInstantString(value: string): boolean {
  if (!INSTANT_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * The state's UTC offset minus Central's, in whole hours, at an instant.
 */
export function offsetHoursFromPractice(zone: string, instantMs: number): number {
  const stateOffset = zoneOffsetMs(zone, instantMs);
  const practiceOffset = zoneOffsetMs(PRACTICE_ZONE, instantMs);
  return Math.round((stateOffset - practiceOffset) / 3600000);
}
