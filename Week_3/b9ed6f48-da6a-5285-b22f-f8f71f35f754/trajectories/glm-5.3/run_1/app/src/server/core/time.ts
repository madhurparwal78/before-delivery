/**
 * Lisbon wall-clock time. The institution's zone is Europe/Lisbon: +00:00 in
 * winter, +01:00 in summer. DST transitions:
 * - Forward: 01:00 -> 02:00 on the last Sunday of March (01:00:00-01:59:59 missing).
 * - Back: 02:00 -> 01:00 on the last Sunday of October (01:00:00-01:59:59 twice;
 *   the first occurrence is meant, at +01:00).
 */

export interface LisbonInstant {
  /** milliseconds since epoch */
  ms: number;
  /** offset in minutes in force at that instant (+0 or +60) */
  offsetMinutes: number;
}

function lastSundayOfMonth(year: number, month: number): Date {
  // month 2 = March, month 9 = October (1-based)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month - 1, daysInMonth));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

/** Transition instants (ms) for a given year in Lisbon. */
export function transitions(year: number): { forwardMs: number; backMs: number } {
  const marchSunday = lastSundayOfMonth(year, 3);
  const octoberSunday = lastSundayOfMonth(year, 10);
  // Forward: 01:00 local (= 01:00 UTC since winter offset is 0) becomes 02:00.
  const forwardMs = Date.UTC(year, 2, marchSunday.getUTCDate(), 1, 0, 0);
  // Back: 01:00 local (+01:00) becomes 01:00 (+00:00); the wall clock reaches
  // 02:00 +01:00 == 01:00 UTC at the transition instant.
  const backMs = Date.UTC(year, 9, octoberSunday.getUTCDate(), 1, 0, 0);
  return { forwardMs, backMs };
}

/** Offset (minutes) in force at the given instant. */
export function offsetAt(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const { forwardMs, backMs } = transitions(year);
  if (ms >= forwardMs && ms < backMs) return 60;
  return 0;
}

export interface WallResult {
  status: 'ok';
  ms: number;
  offsetMinutes: number;
}

export interface WallMissing {
  status: 'missing';
}

/**
 * Convert a Lisbon wall time (given as date parts) to an instant.
 * A repeated hour means its first occurrence; a missing hour is refused.
 */
export function wallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): WallResult | WallMissing {
  return computeWall(year, month, day, hour, minute, second);
}

export function computeWall(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): WallResult | WallMissing {
  const { forwardMs, backMs } = transitions(year);
  const naiveWinter = Date.UTC(year, month - 1, day, hour, minute, second);
  const naiveSummer = naiveWinter - 3_600_000;
  // Wall times 01:00-01:59 on the spring-forward day do not exist: read as
  // winter they fall in [forwardMs, forwardMs + 1h).
  if (naiveWinter >= forwardMs && naiveWinter < forwardMs + 3_600_000) {
    return { status: 'missing' };
  }
  // Summer instants run from the spring jump to the autumn jump, and the first
  // occurrence of the repeated autumn hour is the summer reading.
  if (naiveSummer >= forwardMs && naiveSummer < backMs) {
    return { status: 'ok', ms: naiveSummer, offsetMinutes: 60 };
  }
  return { status: 'ok', ms: naiveWinter, offsetMinutes: 0 };
}

/** Offset in force at a given wall-clock date and hour on that date (for formatting). */
export function offsetForWall(year: number, month: number, day: number, hour: number): number {
  const r = computeWall(year, month, day, hour, 0, 0);
  return r.status === 'ok' ? r.offsetMinutes : 0;
}

/** ISO string with the Lisbon offset in force at that instant. */
export function toOffsetIso(ms: number): string {
  const off = offsetAt(ms);
  const sign = off === 0 ? '+' : '+';
  const hh = String(Math.floor(off / 60)).padStart(2, '0');
  const mm = String(off % 60).padStart(2, '0');
  const d = new Date(ms + off * 60_000);
  const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${iso}${sign}${hh}:${mm}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "Sat 14 Nov 2026, 18:30 Lisbon time" from an instant. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toDisplayDatetime(ms: number): string {
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Lisbon time`;
}

/** "30 Nov 2026" from an instant, in Lisbon time. */
export function toDisplayDate(ms: number): string {
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "YYYY-MM-DD" in Lisbon time. */
export function toDateIso(ms: number): string {
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Start of the Lisbon day (00:00) containing this instant. */
export function startOfDay(ms: number): number {
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return utcMidnight - off * 60_000;
}

/** Start of the Lisbon month containing this instant (as YYYY-MM). */
export function monthKey(ms: number): string {
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Parse "YYYY-MM" to the start of that Lisbon month. */
export function monthStart(key: string): number {
  const [y, m] = key.split('-');
  return Date.UTC(Number(y), Number(m) - 1, 1);
}

export function monthEnd(key: string): number {
  const [y, m] = key.split('-');
  return Date.UTC(Number(y), Number(m), 1);
}

export function parseMonth(key: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

/**
 * Parse a Lisbon wall-clock string as sent by the browser:
 * "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM" (seconds optional).
 * Returns the ISO string with the correct offset, or null when the format is
 * wrong, or 'missing' when the wall time does not exist.
 */
export function parseLisbonEntry(
  text: string,
): { kind: 'ok'; iso: string; ms: number } | { kind: 'bad' } | { kind: 'missing' } {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { kind: 'bad' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return { kind: 'bad' };
  if (hour > 23 || minute > 59 || second > 59) return { kind: 'bad' };
  const r = computeWall(year, month, day, hour, minute, second);
  if (r.status === 'missing') return { kind: 'missing' };
  return { kind: 'ok', iso: toOffsetIso(r.ms), ms: r.ms };
}

export function parseLisbonDate(text: string): { kind: 'ok'; ms: number } | { kind: 'bad' } {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { kind: 'bad' };
  const r = computeWall(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0);
  if (r.status === 'missing') return { kind: 'bad' };
  return { kind: 'ok', ms: r.ms };
}

/** Parse an ISO 8601 instant (with offset or Z). Returns null when invalid. */
export function parseIsoWithOffset(text: string): number | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  if (!m) return null;
  const offsetToken = m[7] ?? 'Z';
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (offsetToken === 'Z') return base;
  const sign = offsetToken[0] === '-' ? -1 : 1;
  const hh = Number(offsetToken.slice(1, 3));
  const mm = Number(offsetToken.slice(4, 6));
  return base - sign * (hh * 60 + mm) * 60_000;
}
