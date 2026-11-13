// The desk clock. "Now" is the server's clock, optionally frozen by
// DESK_CLOCK_FROZEN_AT. Every purchase date, term end, edition start,
// working day and dispatch cut-off is counted on the Europe/London
// calendar, never on UTC or the owner's device.
//
// Europe/London transition instants (from the IANA tz database, 1996-2035).
// BST begins 01:00 UTC on the last Sunday of March; ends 01:00 UTC on the
// last Sunday of October (post-1996 rules; the 1996-2000 era is included via
// the same table for safety, but the desk only relies on 2020-2032).

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

/** UTC instants at which Europe/London switches between GMT and BST. */
const TRANSITIONS: ReadonlyArray<{ readonly at: number; readonly offset: 0 | 1 }> = (() => {
  const out: Array<{ at: number; offset: 0 | 1 }> = [];
  const lastSunday = (year: number, month: number): number => {
    const d = new Date(Date.UTC(year, month, 0));
    const day = d.getUTCDay();
    return d.getUTCDate() - day;
  };
  for (let year = 1996; year <= 2035; year++) {
    const march = Date.UTC(year, 2, lastSunday(year, 3), 1, 0, 0);
    const oct = Date.UTC(year, 9, lastSunday(year, 11), 1, 0, 0);
    out.push({ at: march, offset: 1 }, { at: oct, offset: 0 });
  }
  return out;
})();

function londonOffsetMs(epochMs: number): number {
  let offset = 0;
  for (const t of TRANSITIONS) {
    if (t.at <= epochMs) offset = t.offset;
    else break;
  }
  return offset * 3_600_000;
}

/** A wall-clock date and time on the Europe/London calendar. */
export interface LondonWall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  offset: number; // 0 for GMT, 1 for BST
}

const MS_PER_DAY = 86_400_000;
const DAY_OF_MONTH_CACHE = new Map<string, number>();

export function londonWall(epochMs: number): LondonWall {
  const localMs = epochMs + londonOffsetMs(epochMs);
  const d = new Date(localMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    offset: londonOffsetMs(epochMs) / 3_600_000,
  };
}

/** The Europe/London calendar date (epoch-days) containing this instant. */
export function londonDateOf(epochMs: number): string {
  const w = londonWall(epochMs);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** The instant at 00:00 Europe/London on the given calendar date. */
export function londonMidnight(date: string): number {
  const parts = date.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  // Midnight local can be 23:00Z (BST) or 00:00Z (GMT). Try the earlier of the
  // two candidate instants and pick the one whose London date matches.
  const candidates = [
    Date.UTC(y, m - 1, d) - 3_600_000,
    Date.UTC(y, m - 1, d),
    Date.UTC(y, m - 1, d) + 3_600_000,
  ];
  for (const c of candidates) {
    if (londonDateOf(c) === date) {
      // At midnight, offset is the offset in force just after the instant.
      const after = c + 1000;
      if (londonDateOf(after) === date) return c;
    }
  }
  return Date.UTC(y, m - 1, d);
}

/** Instant at a Europe/London local HH:MM on the given calendar date, resolved
 * per the clock-change rules: skipped local times map to the first instant after
 * the gap; repeated local times map to the earlier of the two instants. */
export function londonLocalInstant(date: string, hhmm: string): number {
  const dateParts = date.split('-').map(Number);
  const timeParts = hhmm.split(':').map(Number);
  const y = dateParts[0] ?? 0;
  const m = dateParts[1] ?? 1;
  const d = dateParts[2] ?? 1;
  const hh = timeParts[0] ?? 0;
  const mm = timeParts[1] ?? 0;
  const wallMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Candidate instants whose wall clock in London reads this local time.
  const candidates = [wallMs - 3_600_000, wallMs, wallMs + 3_600_000].filter((c) => {
    const w = londonWall(c);
    return w.year === y && w.month === m && w.day === d && w.hour === hh && w.minute === mm;
  });
  // In the spring gap there are no candidates: take the first instant after the gap.
  if (candidates.length === 0) {
    // Find the transition instant on this date and return it.
    for (const t of TRANSITIONS) {
      if (londonDateOf(t.at) === date && t.offset === 1) return t.at;
    }
    return wallMs;
  }
  // In the autumn overlap there are two: the earlier one wins.
  return Math.min(...candidates);
}

export function parseInstant(value: string): number | null {
  const m = ISO_INSTANT.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  const ms = Number((frac ?? '0').padEnd(3, '0').slice(0, 3));
  const epoch = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (!Number.isFinite(epoch)) return null;
  return epoch;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= dim;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Purchase date plus whole calendar months; when that day does not exist
 * (29 Feb, the 31st) the anniversary is the first day of the next month. */
export function addCalendarMonths(date: string, months: number): string {
  const parts = date.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = daysInMonth(ny, nm);
  if (d <= dim) {
    return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const nextY = Math.floor((total + 1) / 12);
  const nextM = ((total + 1) % 12) + 1;
  return `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}-01`;
}

/** The day of the week (0=Sunday) of a London calendar date. */
export function weekdayOf(date: string): number {
  if (!DAY_OF_MONTH_CACHE.has(date)) {
    const [y, m, d] = date.split('-').map(Number);
    const midnight = londonMidnight(date);
    void y; void m; void d;
    DAY_OF_MONTH_CACHE.set(date, new Date(midnight).getUTCDay());
  }
  return DAY_OF_MONTH_CACHE.get(date) as number;
}

export function addDays(date: string, days: number): string {
  const parts = date.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const t = Date.UTC(y, m - 1, d) + days * MS_PER_DAY;
  const nd = new Date(t);
  return `${String(nd.getUTCFullYear()).padStart(4, '0')}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
}

/** Instants look like "2026-11-05T12:30:00.000Z" in API payloads. */
export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
