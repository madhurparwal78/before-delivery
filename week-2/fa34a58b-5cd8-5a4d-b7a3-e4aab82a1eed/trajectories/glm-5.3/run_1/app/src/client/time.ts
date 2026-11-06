// Client-side household time helpers. These only format times the server
// publishes (ISO instants with offsets); the browser never decides what is
// "now" — that comes from the server's status alone.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "CDT" for -05:00, "CST" for -06:00. */
export function abbrOfOffset(offset: string): string {
  return offset === '-05:00' ? 'CDT' : 'CST';
}

/** Parse an ISO instant with offset, e.g. "2026-11-01T01:30:00-05:00". */
export function parseInstant(iso: string): number {
  return Date.parse(iso);
}

/** Local wall-clock parts of an ISO instant, taken from its own offset. */
export function partsOf(iso: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; off: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})$/.exec(iso)!;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]), off: m[7] };
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "<HH:MM>" from an ISO instant. */
export function hhmm(iso: string): string {
  const p = partsOf(iso);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "<HH:MM:SS>" from an ISO instant. */
export function hhmmss(iso: string): string {
  const p = partsOf(iso);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** The date part YYYY-MM-DD of an ISO instant. */
export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Weekday name of a YYYY-MM-DD. */
export function weekdayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return WEEKDAYS[d.getUTCDay()];
}

export function weekdayShortOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return WEEKDAYS_SHORT[d.getUTCDay()];
}

/** "Sunday 1 November 2026". */
export function longDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compare two YYYY-MM-DD strings. */
export function dayLt(a: string, b: string): boolean {
  return a < b;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The `<since>` copy: "<HH:MM>" when the owning change falls on the plan day,
 * otherwise "<Ddd> <HH:MM>", plus the abbreviation inside a repeated hour.
 */
export function sinceCopy(iso: string, planDay: string): string {
  const p = partsOf(iso);
  const time = `${pad(p.h)}:${pad(p.mi)}`;
  const repeated = p.h === 1 && p.off === '-06:00';
  const base = dateOf(iso) === planDay ? time : `${weekdayShortOf(dateOf(iso))} ${time}`;
  return repeated ? `${base} CST` : base;
}
