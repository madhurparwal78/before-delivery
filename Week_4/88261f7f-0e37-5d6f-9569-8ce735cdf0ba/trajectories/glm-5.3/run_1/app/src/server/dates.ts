/** All dates are YYYY-MM-DD strings. Time rules read the hotel's clock. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCFullYear() === y;
}

export function parseDate(s: string): string {
  return s;
}

export function toUtcDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtcDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(s: string, days: number): string {
  const dt = toUtcDate(s);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtcDate(dt);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86400000);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Weekday of the date itself: 0 Sunday .. 6 Saturday. */
export function weekday(s: string): number {
  return toUtcDate(s).getUTCDay();
}

export function isWeekend(s: string): boolean {
  const w = weekday(s);
  return w === 5 || w === 6;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** The business date a moment in the hotel's zone belongs to (04:00 roll). */
export function nightOfInstant(inst: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(inst);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  return hour >= 4 ? dateStr : addDays(dateStr, -1);
}

/** Local wall-clock date of an instant in a zone. */
export function localDateOf(inst: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(inst);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Convert a local wall-clock time on a date in a zone to an instant. */
export function localInstantOn(date: string, timeZone: string, hour: number, minute = 0, second = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const offsetMin = zoneOffsetMinutes(new Date(guess), timeZone);
    const candidate = target - offsetMin * 60000;
    if (candidate === guess) break;
    guess = candidate;
  }
  return new Date(guess);
}

/** 04:00:00 local on the date after the given business date. */
export function closeOpensAt(businessDate: string, timeZone: string): Date {
  return localInstantOn(addDays(businessDate, 1), timeZone, 4, 0, 0);
}

export function zoneOffsetMinutes(inst: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(inst);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - inst.getTime()) / 60000);
}

/** 18:00:00 local on a given date in a zone. */
export function localEvening(date: string, timeZone: string): Date {
  return localInstantOn(date, timeZone, 18, 0, 0);
}
