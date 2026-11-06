// Co-op time: every embargo lift, window end, rate date and statement month is entered, judged and shown
// in America/Chicago. The browser's zone and clock are never used; instants arrive from the server.

export const COOP_ZONE = "America/Chicago";

const MINUTE = 60_000;
const DAY = 86_400_000;

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: COOP_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  timeZoneName: "short",
});

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  zone: string;
}

function wallOf(at: Date): Wall {
  const found: Record<string, string> = {};
  for (const p of parts.formatToParts(at)) found[p.type] = p.value;
  return {
    year: Number(found.year), month: Number(found.month), day: Number(found.day),
    hour: Number(found.hour), minute: Number(found.minute),
    weekday: found.weekday ?? "", zone: found.timeZoneName ?? "",
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Whole-second UTC ISO form used by every API instant, e.g. 2026-11-01T06:30:00Z. */
export function isoInstant(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

/** `<co-op time>`: "Sun 1 Nov 2026 · 01:30 CDT". */
export function coopTime(at: Date | string): string {
  const w = wallOf(typeof at === "string" ? new Date(at) : at);
  return `${w.weekday} ${w.day} ${MONTHS_SHORT[w.month - 1]} ${w.year} · ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}

/** CSV time form: `YYYY-MM-DD HH:mm <CST|CDT>`. */
export function coopCsvTime(at: Date | string): string {
  const w = wallOf(typeof at === "string" ? new Date(at) : at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}

/** The co-op calendar date of an instant, as YYYY-MM-DD. */
export function coopDateOf(at: Date): string {
  const w = wallOf(at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** `<co-op date>` for a YYYY-MM-DD calendar date: "Mon 2 Nov 2026". */
export function coopDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** `<month>` for YYYY-MM: "November 2026". */
export function coopMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** Adds whole calendar days to a YYYY-MM-DD date. */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** True when the text is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** True when the text is a real month written YYYY-MM. */
export function isCalendarMonth(text: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(text);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

type LiftResolution = "exact" | "first_occurrence" | "shifted_after_gap";

export interface ResolvedWall {
  at: Date;
  resolution: LiftResolution;
}

const sameWall = (w: Wall, y: number, mo: number, d: number, h: number, mi: number): boolean =>
  w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;

/**
 * Resolves a co-op wall time `YYYY-MM-DDTHH:mm` to one instant. A repeated wall time (autumn fall-back)
 * resolves to its first occurrence; a missing one (spring-forward gap) to the first valid minute after
 * the gap. Returns null when the text is not a real date and time in that form.
 */
export function resolveWall(text: string): ResolvedWall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m || !isCalendarDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Chicago is UTC-5 (CDT) or UTC-6 (CST): the earlier candidate is the first occurrence.
  const candidates = [5, 6].map((hours) => new Date(naive + hours * 3_600_000))
    .filter((at) => sameWall(wallOf(at), y, mo, d, h, mi));
  if (candidates.length === 2) return { at: candidates[0] as Date, resolution: "first_occurrence" };
  if (candidates.length === 1) return { at: candidates[0] as Date, resolution: "exact" };
  // In the gap: find the first minute whose wall time is past the requested one.
  let low = naive + 5 * 3_600_000;
  let high = naive + 6 * 3_600_000;
  const past = (t: number): boolean => {
    const w = wallOf(new Date(t));
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) > naive;
  };
  while (high - low > MINUTE) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
    if (past(mid)) high = mid;
    else low = mid;
  }
  return { at: new Date(high), resolution: "shifted_after_gap" };
}

/** 00:00 co-op time at the start of a YYYY-MM-DD date. */
export function coopMidnight(day: string): Date {
  const resolved = resolveWall(`${day}T00:00`);
  if (!resolved) throw new RangeError(`not a calendar date: ${day}`);
  return resolved.at;
}

/** A statement month runs from co-op midnight on its first day to co-op midnight on the next month's first day. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return { start: coopMidnight(`${month}-01`), end: coopMidnight(`${next}-01`) };
}

/**
 * An exclusive window or standard licence starts at confirmation and runs through date D, the co-op date of
 * the later of confirmation and lift plus `days - 1`; it ends at co-op midnight after D.
 */
export function windowEnd(confirmedAt: Date, liftAt: Date, days: number): Date {
  const from = confirmedAt > liftAt ? confirmedAt : liftAt;
  return coopMidnight(addDays(coopDateOf(from), days));
}

const HOLD_MS = 30 * MINUTE;

/** A pending licence holds its window until the earlier of confirmation + 30 minutes and its window end. */
export function holdDeadline(confirmedAt: Date, end: Date): Date {
  const hold = new Date(confirmedAt.getTime() + HOLD_MS);
  return hold < end ? hold : end;
}
