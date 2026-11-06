// Local-day and local-week boundaries in an IANA zone, honouring missing and repeated midnights.
// A local date's start is the earliest instant whose local date equals that date. For a skipped
// midnight (spring forward over 00:00) that is the transition instant itself; for a repeated
// midnight it is the first occurrence of 00:00.

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export function wallComponents(ms: number, zone: string): Wall {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : 0;
  };
  let h = get('hour');
  if (h === 24) h = 0; // some ICU builds report 24 for midnight
  return { y: get('year'), m: get('month'), d: get('day'), h, mi: get('minute'), s: get('second'), ms: ms % 1000 };
}

export function dateKey(ms: number, zone: string): string {
  const w = wallComponents(ms, zone);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

const dayStartCache = new Map<string, number>();

// Earliest instant whose local date in `zone` is y-m-d. The local date of an instant is a
// non-decreasing function of the instant, so the boundary is found by bisection on that predicate.
export function dayStartOf(zone: string, y: number, m: number, d: number): number {
  const key = `${zone}|${y}-${m}-${d}`;
  const hit = dayStartCache.get(key);
  if (hit !== undefined) return hit;

  const target = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const at = (u: number): boolean => dateKey(u, zone) >= target;

  const naive = Date.UTC(y, m - 1, d); // wall midnight read as if UTC
  // Estimate the offset near that date to centre the search window.
  const sample = naive + 12 * 3600 * 1000;
  const sw = wallComponents(sample, zone);
  const offset = Date.UTC(sw.y, sw.m - 1, sw.d, sw.h, sw.mi, sw.s) - sample;
  let hi = naive - offset + 3 * 3600 * 1000; // past the boundary: later local date or later wall time
  if (!at(hi)) hi = naive + 3 * 3600 * 1000;
  if (!at(hi)) hi = naive + 15 * 3600 * 1000;
  let lo = naive - offset - 3 * 3600 * 1000;
  if (at(lo)) lo = naive - 15 * 3600 * 1000;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid)) hi = mid;
    else lo = mid;
  }
  dayStartCache.set(key, hi);
  return hi;
}

export function dayStart(ms: number, zone: string): number {
  const w = wallComponents(ms, zone);
  return dayStartOf(zone, w.y, w.m, w.d);
}

export function nextDayStart(ms: number, zone: string): number {
  const w = wallComponents(dayStart(ms, zone), zone);
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d) + 86400 * 1000);
  return dayStartOf(zone, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function weekStart(ms: number, zone: string): number {
  const w = wallComponents(ms, zone);
  const weekday = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(); // 0=Sun
  const monday = Date.UTC(w.y, w.m - 1, w.d) - ((weekday + 6) % 7) * 86400 * 1000;
  const mon = new Date(monday);
  return dayStartOf(zone, mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate());
}

export function nextWeekStart(ms: number, zone: string): number {
  // The next Monday's wall date is exactly seven days after this week's Monday wall date.
  const w = wallComponents(weekStart(ms, zone), zone);
  const next = new Date(Date.UTC(w.y, w.m - 1, w.d) + 7 * 86400 * 1000);
  return dayStartOf(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function isValidZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function formatInstant(ms: number, zone: string): string {
  const w = wallComponents(ms, zone);
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

export function formatInstantDateTime(ms: number, zone: string): string {
  const w = wallComponents(ms, zone);
  const date = new Date(Date.UTC(w.y, w.m - 1, w.d));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.m - 1];
  return `${weekday} ${w.d} ${month}, ${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}
