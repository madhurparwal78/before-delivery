/**
 * Kitchen-time helpers. Every date, "today" and month boundary in Lineboard is
 * computed in the kitchen's IANA time zone, never the server's or browser's.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export function localDateInZone(instant: Date, timeZone: string): string {
  const parts = partsFmt(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localTimeInZone(instant: Date, timeZone: string): string {
  const parts = partsFmt(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const h = get('hour') === '24' ? '00' : get('hour');
  return `${h}:${get('minute')}`;
}

export function todayInZone(instant: Date, timeZone: string): string {
  return localDateInZone(instant, timeZone);
}

export function currentMonthInZone(instant: Date, timeZone: string): string {
  return todayInZone(instant, timeZone).slice(0, 7);
}

export function utcOffsetString(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const name = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName')!.value;
  // "GMT-04:00" or "GMT+5:30" or "GMT"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return '+00:00';
  const sign = m[1] === '-' ? '-' : '+';
  const hh = m[2].padStart(2, '0');
  return `${sign}${hh}:${m[3] ?? '00'}`;
}

/** ISO 8601 instant with the kitchen's UTC offset in force at that instant. */
export function formatInstant(instant: Date, timeZone: string): string {
  const parts = partsFmt(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const h = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${h}:${get('minute')}:${get('second')}${utcOffsetString(instant, timeZone)}`;
}

function offsetsAround(localDate: string, timeZone: string): number[] {
  // Collect the UTC offsets in force on the day before, the day itself and the day after.
  const base = Date.parse(`${localDate}T12:00:00Z`);
  const set = new Set<number>();
  for (let d = -2; d <= 2; d++) {
    const probe = new Date(base + d * 86400000);
    const off = offsetMinutes(probe, timeZone);
    set.add(off);
  }
  return [...set];
}

export function offsetMinutes(instant: Date, timeZone: string): number {
  const s = utcOffsetString(instant, timeZone);
  const sign = s[0] === '-' ? -1 : 1;
  const hh = Number(s.slice(1, 3));
  const mm = Number(s.slice(4, 6));
  return sign * (hh * 60 + mm);
}

export type ResolveResult =
  | { ok: true; instant: Date; ambiguous: boolean }
  | { ok: false; reason: 'nonexistent' };

/** The instant of a resolved local time; assumes ok was checked. */
export function resolvedInstant(result: ResolveResult): Date {
  return result.ok ? result.instant : new Date(NaN);
}

/**
 * Resolve a kitchen-local wall time on a date to an instant.
 * A time inside a spring-forward gap does not exist; a repeated fall-back
 * time means its first (earlier) occurrence.
 */
export function resolveLocal(localDate: string, hhmm: string, timeZone: string): ResolveResult {
  const wallMs = Date.parse(`${localDate}T${hhmm}:00Z`);
  if (Number.isNaN(wallMs)) return { ok: false, reason: 'nonexistent' };
  const candidates = offsetsAround(localDate, timeZone);
  const matches: { instant: Date; offset: number }[] = [];
  for (const off of candidates) {
    const instant = new Date(wallMs - off * 60000);
    if (offsetMinutes(instant, timeZone) === off && localDateInZone(instant, timeZone) === localDate) {
      const hh = localTimeInZone(instant, timeZone);
      if (hh === hhmm) matches.push({ instant, offset: off });
    }
  }
  if (matches.length === 0) return { ok: false, reason: 'nonexistent' };
  matches.sort((a, b) => a.offset - b.offset);
  return { ok: true, instant: matches[0].instant, ambiguous: matches.length > 1 };
}

export function isLocalDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isMonth(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s) && Number.isNaN(Date.parse(`${s}-01T00:00:00Z`)) === false;
}

/** The month a kitchen-local date falls in. */
export const monthOf = (date: string): string => date.slice(0, 7);

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000);
  return dateFmt.format(d);
}

export function weekdayOf(date: string): Weekday {
  const d = new Date(Date.parse(`${date}T12:00:00Z`));
  return WEEKDAYS[d.getUTCDay()];
}

/** Wall-clock hours of a block: local end minus local start, 24:00 counting as hour 24. */
export function wallClockHours(localStart: string, localEnd: string): number {
  const toH = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
  };
  const end = localEnd === '24:00' ? 24 : toH(localEnd);
  return end - toH(localStart);
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/\.25$/, '.25').replace(/\.5$/, '.5').replace(/\.75$/, '.75');
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-$' : '$'}${dollars}.${frac}`;
}

/** "<Weekday> <D> <Month> <YYYY>", for example "Tuesday 27 October 2026". */
export function formatHeadingDate(date: string): string {
  const d = new Date(Date.parse(`${date}T12:00:00Z`));
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(d);
  const day = Number(date.slice(8, 10));
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(d);
  return `${weekday} ${day} ${month} ${date.slice(0, 4)}`;
}

/** "<date> <HH:MM>" of an instant in kitchen time. */
export function formatDateTime(instant: Date, timeZone: string): string {
  return `${localDateInZone(instant, timeZone)} ${localTimeInZone(instant, timeZone)}`;
}
