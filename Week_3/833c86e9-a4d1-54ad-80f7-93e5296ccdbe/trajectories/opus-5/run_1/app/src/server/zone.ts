const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

interface WallParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function wallPartsOf(zone: string, utcMs: number): WallParts {
  const parts = formatter(zone).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function wallMsOf(zone: string, utcMs: number): number {
  const p = wallPartsOf(zone, utcMs);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
}

function offsetMsAt(zone: string, utcMs: number): number {
  return wallMsOf(zone, utcMs) - utcMs;
}

/** The first instant at or after `from` where the zone's offset changes. */
function transitionAfter(zone: string, from: number, to: number): number | null {
  const startOffset = offsetMsAt(zone, from);
  if (offsetMsAt(zone, to) === startOffset) return null;
  let lo = from;
  let hi = to;
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (mid === lo) break;
    if (offsetMsAt(zone, mid) === startOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The instant of a wall-clock time in a zone. A time skipped on a daylight
 * saving day moves forward to the first valid minute after the gap; a
 * repeated time uses its first occurrence.
 */
export function wallToUtc(zone: string, y: number, m: number, d: number, h: number, mi: number): number {
  const target = Date.UTC(y, m - 1, d, h, mi, 0);
  const probes = [target, target - DAY_MS, target + DAY_MS];
  const candidates = new Set<number>();
  for (const probe of probes) {
    const o = offsetMsAt(zone, probe);
    candidates.add(target - o);
    candidates.add(target - offsetMsAt(zone, target - o));
  }
  const valid: number[] = [];
  for (const c of candidates) if (wallMsOf(zone, c) === target) valid.push(c);
  if (valid.length > 0) return Math.min(...valid);
  const t = transitionAfter(zone, target - 2 * DAY_MS, target + 2 * DAY_MS);
  return t ?? target;
}

export function localDate(zone: string, utcMs: number): string {
  const p = wallPartsOf(zone, utcMs);
  return isoDate(p.y, p.m, p.d);
}

/** `YYYY-MM-DDTHH:mm` in the zone. */
export function localDateTime(zone: string, utcMs: number): string {
  const p = wallPartsOf(zone, utcMs);
  return `${isoDate(p.y, p.m, p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

export function parseDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function isDate(iso: string): boolean {
  return parseDate(iso) !== null;
}

function dayMs(iso: string): number {
  const p = parseDate(iso);
  if (!p) throw new Error(`bad date ${iso}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(dayMs(iso) + n * DAY_MS);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole calendar days from `a` to `b`. */
export function diffDays(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

/** ISO weekday, Monday 1 to Sunday 7. */
export function isoWeekday(iso: string): number {
  const d = new Date(dayMs(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function datesBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let date = from; date < toExclusive; date = addDays(date, 1)) out.push(date);
  return out;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function firstOfMonth(month: string): string {
  return `${month}-01`;
}

export function lastOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? isoDate(y + 1, 1, 1) : isoDate(y, m + 1, 1);
  return addDays(next, -1);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad((total % 12) + 1)}`;
}
