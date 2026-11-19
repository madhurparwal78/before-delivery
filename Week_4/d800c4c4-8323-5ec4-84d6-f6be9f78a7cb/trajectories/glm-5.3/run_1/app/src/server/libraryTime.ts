// Library time: every date and cutoff is decided in the library time zone.
// The library zone is stored in settings; this module owns the wall-clock conversion.

export interface LibraryTime {
  /** The IANA zone name, e.g. "America/Chicago". */
  zone: string;
}

/**
 * Convert an absolute instant to library wall-clock parts.
 * Implemented through Intl with the "en-US" locale, computing the zone's offset for the instant.
 */
export function zonedParts(instant: Date, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = dateTimeFormat(zone);
  const parts = dtf.formatToParts(instant);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** The library time zone's offset in minutes for an instant. */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const parts = zonedParts(instant, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/** Format the offset as ±HH:MM. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/** ISO 8601 with the library zone's offset in force at that instant, e.g. 2026-11-01T01:30:00-06:00. */
export function isoInZone(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  const off = formatOffset(zoneOffsetMinutes(instant, zone));
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}T${pad(p.hour, 2)}:${pad(p.minute, 2)}:${pad(p.second, 2)}${off}`;
}

/** Library-local date, YYYY-MM-DD. */
export function dateInZone(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** Library-local time, HH:MM. */
export function timeInZone(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${pad(p.hour, 2)}:${pad(p.minute, 2)}`;
}

/**
 * Build an instant from library wall-clock parts, choosing the occurrence matched by pickHour.
 * pickHour 1 means the first occurrence (clocks go forward past it), pickHour 2 the second.
 * Returns null when the wall-clock time never happens in the zone.
 */
export function instantFromZoned(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  pickHour: 1 | 2,
): Date | null {
  // Try candidate offsets. The correct offset is the zone's offset at the candidate instant.
  // Enumerate plausible offsets: offsets of the zone at the start and end of that day, plus ±1h variants.
  const dayStartUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const candidates = new Set<number>();
  for (const probeMs of [dayStartUtc, dayStartUtc + 86400000]) {
    const off = zoneOffsetMinutes(new Date(probeMs), zone);
    candidates.add(off);
    candidates.add(off - 60);
    candidates.add(off + 60);
  }
  const hits: number[] = [];
  for (const off of candidates) {
    const guess = dayStartUtc + (hour * 60 + minute) * 60000 + second * 1000 - off * 60000;
    const inst = new Date(guess);
    const p = zonedParts(inst, zone);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && p.second === second) {
      hits.push(guess);
    }
  }
  hits.sort((a, b) => a - b);
  const unique = hits.filter((v, i) => i === 0 || v - (hits[i - 1] ?? v) > 3600000);
  if (unique.length === 0) return null;
  const chosen = pickHour === 2 && unique.length > 1 ? unique[1]! : unique[0]!;
  return new Date(chosen);
}

/** The hour abbreviation for the zone at an instant, e.g. "CST". */
export function zoneAbbreviation(instant: Date, zone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
  const parts = dtf.formatToParts(instant);
  const p = parts.find((x) => x.type === 'timeZoneName');
  const name = p !== undefined ? p.value : '';
  // "CDT" or "GMT-6": take the alpha part when present.
  const match = /^[A-Z]{2,5}$/.exec(name.trim());
  return match !== null ? match[0] : name.replace(/^GMT/, 'UTC').trim();
}

/** Whether a library wall-clock hour is repeated (clocks go back over it) on that date. */
export function isRepeatedHour(zone: string, year: number, month: number, day: number, hour: number): boolean {
  const first = instantFromZoned(zone, year, month, day, hour, 0, 0, 1);
  if (first === null) return false;
  const second = instantFromZoned(zone, year, month, day, hour, 0, 0, 2);
  return second !== null && second.getTime() !== first.getTime();
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(zone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(zone);
  if (dtf === undefined) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    dtfCache.set(zone, dtf);
  }
  return dtf;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
