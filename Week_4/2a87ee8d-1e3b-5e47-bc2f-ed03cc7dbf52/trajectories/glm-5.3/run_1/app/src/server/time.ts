/** Timestamp helpers. Instants are ISO 8601 UTC with exactly three fractional digits. */

export function toStamp(d: Date): string {
  const iso = d.toISOString(); // 2027-03-28T12:00:00.123Z
  return iso.length === 24 ? iso : `${iso.slice(0, 20)}.000Z`;
}

export function nowStamp(): string {
  return toStamp(new Date());
}

export function parseStamp(s: string): number {
  return Date.parse(s);
}

export function parseExactStamp(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

export function dateKey(d: Date, timeZone: string): string {
  // YYYY-MM-DD in a zone, without Intl.formatToParts (partial Node tz data)
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(d);
}

export function hhmm(d: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  return dtf.format(d);
}

export function dayStamp(d: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric' });
  return dtf.format(d).replace(/ /g, ' ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

/** "4 Mar 2027" in the given zone. */
export function longDate(d: Date, timeZone: string): string {
  const parts = zoneParts(d, timeZone);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export interface ZoneParts { year: number; month: number; day: number; hour: number; minute: number; }

/** Wall-clock parts of an instant in a zone. */
export function zoneParts(d: Date, timeZone: string): ZoneParts {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute),
  };
}

/** Offset in ms of the zone at the given instant (zone time ahead of UTC). */
export function zoneOffsetMs(d: Date, timeZone: string): number {
  const p = zoneParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(d.getTime() / 60000) * 60000;
}

/**
 * Resolve a local wall-clock time (YYYY-MM-DDTHH:MM) in a zone to an instant,
 * applying that zone's daylight-saving rules (DP-65):
 * - a spring-forward gap resolves to null
 * - a fall-back overlap resolves to the earlier instant (the summer offset)
 */
export function resolveWallClock(wall: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const matches = (t: number): boolean => {
    const p = zoneParts(new Date(t), timeZone);
    return p.hour === h && p.minute === mi && p.day === d && p.month === mo && p.year === y;
  };
  // Candidate offsets sampled around the time; every real transition offset is covered.
  const candidates: number[] = [];
  for (const delta of [-12, -6, 0, 6, 12]) {
    const off = zoneOffsetMs(new Date(utcGuess + delta * 3600000), timeZone);
    const t = utcGuess - off;
    if (matches(t) && !candidates.includes(t)) candidates.push(t);
  }
  if (candidates.length === 0) return null; // a gap: the wall time does not exist
  return Math.min(...candidates); // overlap: the earlier instant
}

/** Format a euro amount as a UK-formatted string: 1,250.10 (DP-51's <amount>). */
export function formatEuros(amount: string): string {
  const neg = amount.startsWith('-');
  const a = neg ? amount.slice(1) : amount;
  const [int, dec] = a.split('.');
  const padded = dec === undefined ? '00' : dec.padEnd(2, '0').slice(0, 2);
  const groups = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + `${groups}.${padded}`;
}

/** Whole seconds until the next local midnight in the zone, rounded up. */
export function secondsUntilMidnight(d: Date, timeZone: string): number {
  const p = zoneParts(d, timeZone);
  const nextDay = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0));
  const y = nextDay.getUTCFullYear(), mo = nextDay.getUTCMonth() + 1, dd = nextDay.getUTCDate();
  const wall = `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}T00:00`;
  let t = resolveWallClock(wall, timeZone);
  if (t === null) t = resolveWallClock(`${wall.slice(0, 11)}01:00`, timeZone);
  if (t === null) return 3600;
  return Math.ceil((t - d.getTime()) / 1000);
}
