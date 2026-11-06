export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function zoneParts(ms: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const pick = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset in milliseconds to add to UTC to get local wall-clock time at that instant. */
export function offsetAt(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export interface LocalWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Instants matching a wall-clock time in a zone: empty when a clock change skips it,
 * two entries when a clock change repeats it (earliest first).
 */
export function zonedToUtcCandidates(local: LocalWallClock, timeZone: string): number[] {
  const wanted = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const found: number[] = [];
  for (const probe of [wanted - 86400000, wanted, wanted + 86400000]) {
    const candidate = wanted - offsetAt(probe, timeZone);
    if (found.includes(candidate)) continue;
    const p = zoneParts(candidate, timeZone);
    if (
      p.year === local.year &&
      p.month === local.month &&
      p.day === local.day &&
      p.hour === local.hour &&
      p.minute === local.minute &&
      p.second === local.second
    ) {
      found.push(candidate);
    }
  }
  return found.sort((a, b) => a - b);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatLocalDateTime(ms: number, timeZone: string): string {
  const p = zoneParts(ms, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function zoneAbbreviation(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(ms));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/** The `<local time>` format: `YYYY-MM-DD HH:MM` plus the zone abbreviation. */
export function formatStationStamp(iso: string | number | Date, timeZone: string): string {
  const ms = iso instanceof Date ? iso.getTime() : typeof iso === 'number' ? iso : new Date(iso).getTime();
  return `${formatLocalDateTime(ms, timeZone)} ${zoneAbbreviation(ms, timeZone)}`;
}

/** Local `YYYY-MM-DDTHH:MM` / `...:SS` text, as stored for a season cutoff. */
export function formatLocalIsoMinutes(ms: number, timeZone: string): string {
  const p = zoneParts(ms, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const LOCAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseLocalIso(text: string): LocalWallClock | null {
  const m = LOCAL_ISO_RE.exec(text);
  if (!m) return null;
  const local: LocalWallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
  if (local.month < 1 || local.month > 12 || local.day < 1 || local.day > 31) return null;
  if (local.hour > 23 || local.minute > 59 || local.second > 59) return null;
  return local;
}
