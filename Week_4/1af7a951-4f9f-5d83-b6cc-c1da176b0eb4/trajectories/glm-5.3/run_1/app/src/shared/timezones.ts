// Time-zone helpers built on the runtime's own IANA zone database, so the
// server and the browser always agree, DST included.

const REGION_PREFIXES = ['Africa/', 'America/', 'Antarctica/', 'Arctic/', 'Asia/', 'Atlantic/', 'Australia/', 'Europe/', 'Indian/', 'Pacific/'];

const knownZoneCache = new Map<string, boolean>();

function runtimeKnows(zone: string): boolean {
  const cached = knownZoneCache.get(zone);
  if (cached !== undefined) return cached;
  let known = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    known = true;
  } catch {
    known = false;
  }
  knownZoneCache.set(zone, known);
  return known;
}

function etcZoneValid(zone: string): boolean {
  const m = /^Etc\/GMT([+-])(\d{1,2})$/.exec(zone);
  if (!m) return false;
  const hours = Number(m[2]);
  if (m[1] === '-') return hours >= 1 && hours <= 14;
  return hours >= 0 && hours <= 12 && hours >= 1;
}

export function isAcceptedZone(zone: string): boolean {
  if (zone === 'UTC') return true;
  if (etcZoneValid(zone)) return runtimeKnows(zone);
  if (!REGION_PREFIXES.some((p) => zone.startsWith(p))) return false;
  return runtimeKnows(zone);
}

// Offset in minutes east of UTC at the given instant.
export function offsetMinutesAt(zone: string, instant: Date): number {
  const dtf = formatterFor(zone);
  const parts = dtf.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const asUTC = Date.UTC(instant.getUTCFullYear(), 0, 1) * 0 + Date.UTC(1970, 0, 1, hour, minute, second);
  void asUTC;
  // use the timeZoneName with shortOffset to get the offset directly
  const offsetDtf = offsetFormatterFor(zone);
  const oparts = offsetDtf.formatToParts(instant);
  const name = oparts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  }
  if (name === 'UTC' || name === 'GMT') return 0;
  // fall back to wall-clock difference
  const wall = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    minute,
    second,
  );
  return Math.round((wall - instant.getTime()) / 60000);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached !== undefined) return cached;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  formatterCache.set(zone, dtf);
  return dtf;
}

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
function offsetFormatterFor(zone: string): Intl.DateTimeFormat {
  const cached = offsetFormatterCache.get(zone);
  if (cached !== undefined) return cached;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  });
  offsetFormatterCache.set(zone, dtf);
  return dtf;
}

const DATE_KEY = /(\d{4})-(\d{2})-(\d{2})/;

export function isValidDateKey(key: string): boolean {
  const m = DATE_KEY.exec(key);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function addDays(key: string, days: number): string {
  const m = DATE_KEY.exec(key);
  if (!m) return key;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export interface ZoneClock {
  ymd(instant: Date): string;
  hm(instant: Date): string;
  dateAtLocal(ymdKey: string, hhmm: string): Date;
}

export function clockFor(zone: string): ZoneClock {
  return {
    ymd(now: Date): string {
      const dtf = formatterFor(zone);
      const parts = dtf.formatToParts(now);
      const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    },
    hm(now: Date): string {
      const dtf = formatterFor(zone);
      const parts = dtf.formatToParts(now);
      const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('hour')}:${get('minute')}`;
    },
    dateAtLocal(ymdKey: string, hhmm: string): Date {
      // invert the zone by refining a guess against the actual offset
      const naive = Date.parse(`${ymdKey}T${hhmm}:00Z`);
      let guess = naive;
      for (let i = 0; i < 3; i += 1) {
        const offset = offsetMinutesAt(zone, new Date(guess));
        const next = naive - offset * 60000;
        if (next === guess) break;
        guess = next;
      }
      return new Date(guess);
    },
  };
}

export function formatInstantUTC(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

