// One place for Brussels day boundaries (DP-16).
// Europe/Brussels: CET (UTC+1) with DST to CEST (UTC+2), last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC.

const BRUSSELS_TZ = 'Europe/Brussels';

/** Local midnight of a Brussels date, as a UTC instant in whole seconds. */
export function brusselsMidnight(date: string): Date {
  return localWallClockToUtc(date, '00:00:00');
}

/** Convert a Brussels wall-clock date+time to the UTC instant, using the real zone rules. */
export function localWallClockToUtc(date: string, time: string): Date {
  const iso = `${date}T${time}`;
  // Date parsing of a local-time string uses the host zone; instead use the offset trick:
  const asUtc = Date.parse(`${iso}Z`);
  const offset = brusselsOffsetMs(asUtc);
  return new Date(asUtc - offset);
}

/** The IANA zone offset in ms at a given instant. */
function brusselsOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BRUSSELS_TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second')
  );
  return asUtc - utcMs;
}

/** Add N calendar days to a YYYY-MM-DD date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Difference in calendar days between two YYYY-MM-DD dates (a - b). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** The Brussels date (YYYY-MM-DD) of a UTC instant. */
export function brusselsDateOf(instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRUSSELS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(instant);
}

/** The Brussels wall clock parts of a UTC instant. */
export function brusselsTimeParts(instant: Date): { date: string; time: string; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: BRUSSELS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${String(hour).padStart(2, '0')}:${get('minute')}`,
    hour,
    minute: Number(get('minute')),
  };
}

/** Whole-second UTC instant, truncated (never rounded up). */
export function cutToSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/** Format an instant as UTC whole seconds with a Z (DP-54). */
export function toZ(instant: Date): string {
  return cutToSecond(instant).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
