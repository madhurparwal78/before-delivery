// Local days and weeks in an islander's saved IANA zone, from the Node.js zone data.
// A local day starts at the first instant whose local date is that day, which covers missing
// midnights (the day starts after the gap) and repeated midnights (the first occurrence).

const DAY_MS = 86400000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(zone, f);
  }
  return f;
}

/** A calendar date as days since 1970-01-01, so date arithmetic is integer arithmetic. */
type LocalDate = number;

function localDate(at: number, zone: string): LocalDate {
  const parts = formatter(zone).formatToParts(new Date(at));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY_MS);
}

function dayStart(zone: string, date: LocalDate): number {
  let lo = date * DAY_MS - 2 * DAY_MS;
  let hi = lo + 4 * DAY_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid, zone) >= date) hi = mid;
    else lo = mid;
  }
  return hi;
}

interface Period {
  start: number;
  end: number;
}

export function localDay(at: number, zone: string): Period {
  const d = localDate(at, zone);
  return { start: dayStart(zone, d), end: dayStart(zone, d + 1) };
}

export function localWeek(at: number, zone: string): Period {
  const d = localDate(at, zone);
  const weekday = (((d + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday; Monday is 0
  const monday = d - weekday;
  return { start: dayStart(zone, monday), end: dayStart(zone, monday + 7) };
}

/** The first local day start strictly after `at`. */
export function nextDayStart(at: number, zone: string): number {
  return localDay(at, zone).end;
}

/** The first local Monday 00:00 strictly after `at`. */
export function nextWeekStart(at: number, zone: string): number {
  return localWeek(at, zone).end;
}

export function knownZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
