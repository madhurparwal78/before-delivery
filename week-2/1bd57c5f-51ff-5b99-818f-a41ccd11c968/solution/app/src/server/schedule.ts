// Site visit times: job-local wall clock to UTC with each date's own offset, recurrence
// rules judged by date arithmetic before any expansion, and occurrence expansion.
import type { OccurrenceStatus, Recurrence, Weekday } from "../shared/domain";

interface LocalDateTime {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS */
  time: string;
}

const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export interface Occurrence {
  date: string;
  startsLocal: string;
  endsLocal: string;
  startsUtc: Date | null;
  endsUtc: Date | null;
  status: OccurrenceStatus;
}

interface VisitException {
  date: string;
  status: "moved" | "cancelled";
  startsLocal: string | null;
  endsLocal: string | null;
}

type RecurrenceCheck = { ok: true; rule: Recurrence | null; dates: string[] } | { ok: false; message: string };

const DAY_MS = 86_400_000;
const MAX_COUNT = 60;
const MAX_SPAN_DAYS = 180;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function dateMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function validDate(y: string, m: string, d: string): boolean {
  return isoDate(Date.UTC(Number(y), Number(m) - 1, Number(d))) === `${y}-${m}-${d}`;
}

/** Reads "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS" as a real calendar date and time. */
export function parseLocal(raw: unknown): LocalDateTime | null {
  const m = typeof raw === "string" ? LOCAL.exec(raw) : null;
  if (!m) return null;
  const [, y = "", mo = "", d = "", h = "", mi = "", s = "00"] = m;
  if (!validDate(y, mo, d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}:${s}` };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The job-local date and time of a UTC instant. */
export function utcToLocal(d: Date, zone: string): LocalDateTime {
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter(zone).formatToParts(d)) parts[type] = value;
  return {
    date: `${pad(Number(parts.year), 4)}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/** The wall-clock reading of an instant, as if it were UTC, in milliseconds. */
function wallMs(instant: number, zone: string): number {
  const { date, time } = utcToLocal(new Date(instant), zone);
  const [h, m, s] = time.split(":").map(Number) as [number, number, number];
  return dateMs(date) + ((h * 60 + m) * 60 + s) * 1000;
}

/** The UTC instant of a local time in the zone; null in a spring-forward gap, the earlier one when repeated. */
export function localToUtc(date: string, time: string, zone: string): Date | null {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  const wall = dateMs(date) + ((h * 60 + m) * 60 + s) * 1000;
  const offsets = new Set([-DAY_MS, 0, DAY_MS].map((shift) => wallMs(wall + shift, zone) - (wall + shift)));
  const matches = [...offsets].map((o) => wall - o).filter((instant) => wallMs(instant, zone) === wall);
  return matches.length ? new Date(Math.min(...matches)) : null;
}

/** The date n days after (or before) a date. */
export function addDays(date: string, n: number): string {
  return isoDate(dateMs(date) + n * DAY_MS);
}

/** Days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateMs(b) - dateMs(a)) / DAY_MS);
}

/** The weekday of a date. */
function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(dateMs(date)).getUTCDay() + 6) % 7] as Weekday;
}

const refuse = (message: string): RecurrenceCheck => ({ ok: false, message });
const given = (v: unknown): boolean => v !== null && v !== undefined;

/** Validates a recurrence rule by date arithmetic, then expands its job-local dates. */
export function checkRecurrence(raw: unknown, startDate: string): RecurrenceCheck {
  if (!given(raw)) return { ok: true, rule: null, dates: [startDate] };
  if (typeof raw !== "object" || Array.isArray(raw)) return refuse("Recurrence must be an object.");
  const r = raw as Record<string, unknown>;
  const freq = r.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "every_n_days") {
    return refuse("Repeat daily, weekly or every few days.");
  }

  // Day offsets from the start date within one repeating cycle, and the cycle length.
  let offsets = [0];
  let cycle = 1;
  const rule: Recurrence = { freq, until: null, count: null };
  if (freq === "weekly") {
    const days = r.weekdays;
    if (!Array.isArray(days) || days.length === 0) return refuse("Pick at least one weekday.");
    if (!days.every((d): d is Weekday => WEEKDAYS.includes(d as Weekday))) return refuse("Use weekdays MO to SU.");
    if (new Set(days).size !== days.length) return refuse("Each weekday may appear only once.");
    const startIndex = WEEKDAYS.indexOf(weekdayOf(startDate));
    if (!days.includes(WEEKDAYS[startIndex] as Weekday)) return refuse("The start date must fall on a chosen weekday.");
    rule.weekdays = WEEKDAYS.filter((d) => days.includes(d));
    offsets = days.map((d) => (WEEKDAYS.indexOf(d) - startIndex + 7) % 7).sort((a, b) => a - b);
    cycle = 7;
  } else if (given(r.weekdays)) {
    return refuse("Weekdays apply only to weekly visits.");
  }
  if (freq === "every_n_days") {
    const interval = r.interval;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 2 || interval > 30) {
      return refuse("Repeat every 2 to 30 days.");
    }
    rule.interval = interval;
    cycle = interval;
  } else if (given(r.interval)) {
    return refuse("An interval applies only to every-few-days visits.");
  }

  if (given(r.until) === given(r.count)) return refuse("Give either an end date or a number of visits, not both.");
  let count: number;
  if (given(r.count)) {
    const c = r.count;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > MAX_COUNT) return refuse("Repeat 1 to 60 times.");
    rule.count = count = c;
  } else {
    const until = r.until;
    const m = typeof until === "string" ? DATE.exec(until) : null;
    if (!m || !validDate(m[1] ?? "", m[2] ?? "", m[3] ?? "")) return refuse("The end date must be a real date.");
    const span = daysBetween(startDate, until as string);
    if (span < 0) return refuse("The end date can't be before the start date.");
    rule.until = until as string;
    const cycles = Math.floor(span / cycle);
    count = cycles * offsets.length + offsets.filter((o) => o <= span % cycle).length;
  }
  if (count > MAX_COUNT) return refuse("A series can have at most 60 visits.");
  const offsetOf = (i: number): number => Math.floor(i / offsets.length) * cycle + (offsets[i % offsets.length] as number);
  if (offsetOf(count - 1) > MAX_SPAN_DAYS) return refuse("A series can span at most 180 days.");

  const dates = Array.from({ length: count }, (_, i) => addDays(startDate, offsetOf(i)));
  return { ok: true, rule, dates };
}

function toUtc(local: string, zone: string): Date | null {
  const parsed = parseLocal(local);
  return parsed ? localToUtc(parsed.date, parsed.time, zone) : null;
}

/** Every occurrence of a series in original-date order, with exceptions applied and UTC times. */
export function expandOccurrences(
  series: { startsLocal: string; endsLocal: string; dates: string[] },
  exceptions: readonly VisitException[],
  zone: string,
): Occurrence[] {
  const start = parseLocal(series.startsLocal);
  const end = parseLocal(series.endsLocal);
  const endShift = start && end ? daysBetween(start.date, end.date) : 0;
  const byDate = new Map(exceptions.map((e) => [e.date, e]));
  return [...series.dates].sort().map((date) => {
    const exception = byDate.get(date);
    const moved = exception?.status === "moved";
    const startsLocal = (moved && exception.startsLocal) || `${date}T${start?.time ?? "00:00:00"}`;
    const endsLocal = (moved && exception.endsLocal) || `${addDays(date, endShift)}T${end?.time ?? "00:00:00"}`;
    return {
      date,
      startsLocal,
      endsLocal,
      startsUtc: toUtc(startsLocal, zone),
      endsUtc: toUtc(endsLocal, zone),
      status: exception?.status ?? "scheduled",
    };
  });
}

/** The access-code window: from 30 minutes before the start (included) to the end (excluded). */
export function codeWindowOpen(o: { startsUtc: Date; endsUtc: Date }, now: Date): boolean {
  return now.getTime() >= o.startsUtc.getTime() - 30 * 60_000 && now.getTime() < o.endsUtc.getTime();
}

/** Half-open [start, end) intervals overlap. */
export function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** "YYYY-MM-DDTHH:MM:SSZ" without milliseconds. */
export function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}
