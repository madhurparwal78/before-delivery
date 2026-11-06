const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timezone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timezone, created);
  return created;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localPartsOf(instant: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Missing ${type} in formatted date`);
    return Number.parseInt(found.value, 10);
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

function offsetMsAt(instant: Date, timezone: string): number {
  const parts = localPartsOf(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

export type LocalResolution =
  | { kind: 'ok'; instant: Date }
  | { kind: 'nonexistent' };

/** Resolves wall-clock parts in a zone to an instant, taking the first occurrence of ambiguous times. */
export function localToInstant(parts: LocalParts, timezone: string): LocalResolution {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const day = 86400000;
  const offsets = new Set<number>([
    offsetMsAt(new Date(asUtc - day), timezone),
    offsetMsAt(new Date(asUtc), timezone),
    offsetMsAt(new Date(asUtc + day), timezone),
  ]);
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    const roundTrip = localPartsOf(new Date(candidate), timezone);
    if (
      roundTrip.year === parts.year &&
      roundTrip.month === parts.month &&
      roundTrip.day === parts.day &&
      roundTrip.hour === parts.hour &&
      roundTrip.minute === parts.minute &&
      roundTrip.second === parts.second
    ) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return { kind: 'nonexistent' };
  return { kind: 'ok', instant: new Date(Math.min(...candidates)) };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `YYYY-MM-DDTHH:MM:SS` in the given zone. */
export function localIsoOf(instant: Date, timezone: string): string {
  const parts = localPartsOf(instant, timezone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(
    parts.minute,
    2,
  )}:${pad(parts.second, 2)}`;
}

/** `YYYY-MM-DD HH:MM` in the given zone. */
export function localMinuteOf(instant: Date, timezone: string): string {
  const parts = localPartsOf(instant, timezone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)} ${pad(parts.hour, 2)}:${pad(
    parts.minute,
    2,
  )}`;
}

/** Day, month name and year, for example `1 November 2026`. */
export function longDateOf(instant: Date, timezone: string): string {
  const parts = localPartsOf(instant, timezone);
  return `${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export function monthLabelOf(instant: Date, timezone: string): string {
  const parts = localPartsOf(instant, timezone);
  return `${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export function parseLocalIso(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const parts: LocalParts = {
    year: Number.parseInt(y!, 10),
    month: Number.parseInt(mo!, 10),
    day: Number.parseInt(d!, 10),
    hour: Number.parseInt(h!, 10),
    minute: Number.parseInt(mi!, 10),
    second: s === undefined ? 0 : Number.parseInt(s, 10),
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  return parts;
}

export function monthStartInstant(year: number, month: number, timezone: string): Date {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const resolution = localToInstant(
      { year, month, day: 1, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 },
      timezone,
    );
    if (resolution.kind === 'ok') return resolution.instant;
  }
  throw new Error(`Cannot resolve the first of month ${year}-${month} in ${timezone}`);
}
