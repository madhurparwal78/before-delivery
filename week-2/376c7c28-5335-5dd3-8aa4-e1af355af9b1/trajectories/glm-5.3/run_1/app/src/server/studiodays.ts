// Studio days: every studio-local rule uses these day starts. A studio day starts at
// its local midnight; when that midnight does not exist (spring-forward from 00:00),
// the day starts at the first instant that exists after it. A local time that occurs
// twice counts as its first occurrence.

const dtfCache = new Map<string, { fmt: Intl.DateTimeFormat; tz: string }>();

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(ms: number, tz: string): Parts {
  let entry = dtfCache.get(tz);
  if (!entry) {
    entry = { fmt: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }), tz };
    dtfCache.set(tz, entry);
  }
  const parts = entry.fmt.formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

// Offset of the zone at the given instant, in minutes east of UTC.
function zoneOffsetMs(ms: number, tz: string): number {
  const p = partsInZone(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (ms % 1000));
}

// The earliest instant whose local wall time is the given one. When the wall time
// occurs twice (clocks went back), the first occurrence wins. When it does not exist
// at all, returns null.
function instantForLocal(tz: string, p: Parts): number | null {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let offset = zoneOffsetMs(guess, tz);
  let t = guess - offset;
  offset = zoneOffsetMs(t, tz);
  t = guess - offset;
  const check = partsInZone(t, tz);
  const same = check.year === p.year && check.month === p.month && check.day === p.day && check.hour === p.hour && check.minute === p.minute && check.second === p.second;
  if (same) return t;
  // Ambiguous (occurs twice): try the other side of the transition.
  const offsetBefore = zoneOffsetMs(t - 1, tz);
  if (offsetBefore !== offset) {
    const t2 = guess - offsetBefore;
    const check2 = partsInZone(t2, tz);
    if (check2.year === p.year && check2.month === p.month && check2.day === p.day && check2.hour === p.hour && check2.minute === p.minute && check2.second === p.second) {
      return Math.min(t, t2);
    }
  }
  return null;
}

export type StudioDate = string; // YYYY-MM-DD

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function studioDateOf(ms: number, tz: string): StudioDate {
  const p = partsInZone(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// First instant of a studio day. Midnight that does not exist (e.g. America/Santiago
// DST start) advances to the first instant that exists after it.
export function dayStart(date: StudioDate, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  for (let hour = 0; hour <= 12; hour++) {
    const t = instantForLocal(tz, { year: y, month: m, day: d, hour, minute: 0, second: 0 });
    if (t !== null) return t;
  }
  // Fallback: should not happen for real zones, but keep a sane answer.
  return Date.UTC(y, m - 1, d);
}

export function today(tz: string, nowMs: number): StudioDate {
  return studioDateOf(nowMs, tz);
}

export function addDays(date: StudioDate, days: number): StudioDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(from: StudioDate, to: StudioDate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function monthOfDate(date: StudioDate): string {
  return date.slice(0, 7);
}

export function isValidMonth(s: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

// The studio-local date a UTC instant was posted on.
export function dateOfInstant(atMs: number, tz: string): StudioDate {
  return studioDateOf(atMs, tz);
}

// Format "<weekday> <day> <month> <year>", e.g. "Thursday 12 November 2026".
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatScreenDate(date: StudioDate): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthName(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1]} ${y}`;
}
