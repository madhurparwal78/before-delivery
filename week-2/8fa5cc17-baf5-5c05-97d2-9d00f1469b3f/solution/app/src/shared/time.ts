// The home clock: every calendar date and shown time in Quire is read on the workspace's IANA zone.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || name.trim() === '' || name !== name.trim()) return false;
  try {
    formatter(name);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: number, zone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter(zone).formatToParts(instant)) {
    if (part.type in out) out[part.type as keyof ZonedParts] = Number(part.value);
  }
  return out;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Today on the home clock, from the given instant (the server's current time). */
export function homeDate(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return isoDate(p.year, p.month, p.day);
}

/** A real calendar date written YYYY-MM-DD. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dateUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const t = new Date(dateUtc(date) + days * DAY_MS);
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The daily note heading: `Thursday 29 October 2026`. */
export function dateHeading(date: string): string {
  const t = new Date(dateUtc(date));
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** `<D> <Mon> <YYYY>, <HH:MM>` on the home clock. */
export function shortTime(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${p.day} ${MONTHS[p.month - 1].slice(0, 3)} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `<expires>`: the stored instant on the current home clock with the zone name. */
export function expiresDisplay(instant: number, zone: string): string {
  return `${shortTime(instant, zone)} ${zone}`;
}

/** `YYYY-MM-DDTHH:MM` of the instant on the home clock. */
export function localMinute(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${isoDate(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function isLocalMinute(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    && isRealDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}

/**
 * Converts a whole home-clock minute to its UTC instant. A minute inside a daylight-saving gap
 * gives null; a minute that occurs twice gives its first occurrence.
 */
export function localMinuteToInstant(value: string, zone: string): number | null {
  const [date, time] = value.split('T');
  const asUtc = dateUtc(date) + Number(time.slice(0, 2)) * 3_600_000 + Number(time.slice(3, 5)) * 60_000;
  const offsets = new Set<number>();
  for (const probe of [asUtc - DAY_MS, asUtc - 3 * 3_600_000, asUtc, asUtc + 3 * 3_600_000, asUtc + DAY_MS]) {
    const p = zonedParts(probe, zone);
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    offsets.add(local - Math.floor(probe / 1000) * 1000);
  }
  const fits = [...offsets].map((offset) => asUtc - offset).filter((instant) => localMinute(instant, zone) === value);
  return fits.length ? Math.min(...fits) : null;
}
