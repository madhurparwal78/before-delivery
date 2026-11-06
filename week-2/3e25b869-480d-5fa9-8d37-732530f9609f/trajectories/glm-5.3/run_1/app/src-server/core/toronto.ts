// Time helpers for the America/Toronto business time zone. Single source of truth
// for Toronto date math and formatting across server and client (mirrored copy lives
// in src/lib/toronto.ts).
export const TORONTO_UTC_OFFSETS = {
  // Standard (EST) offset in minutes
  standard: -300,
  // Daylight (EDT) offset in minutes
  daylight: -240
} as const;

/** IANA zone identifier for Toronto. */
export const TORONTO_TZ = "America/Toronto";

/**
 * Offset in minutes west of UTC for the Toronto local time containing the given instant.
 * DST follows the North American rules in effect for the range 2020-2035, which is
 * computed from the ICU data via Intl below for robustness.
 */
export function torontoOffsetMinutes(instant: Date): number {
  const dtf = torontoDateTimeFormat();
  const parts = dtf.formatToParts(instant);
  let offset = 0;
  // formatToParts alone does not expose the zone offset, so use the trick of
  // comparing the local fields to the instant.
  const asLocal = new Date(
    Number(parts.find((p) => p.type === "year")?.value),
    monthIndex(parts),
    Number(parts.find((p) => p.type === "day")?.value),
    Number(parts.find((p) => p.type === "hour")?.value),
    Number(parts.find((p) => p.type === "minute")?.value),
    Number(parts.find((p) => p.type === "second")?.value)
  ).getTime();
  // Local constructed as if the fields were UTC; difference to the true instant is the offset.
  offset = Math.round((asLocal - instant.getTime()) / 60000);
  return offset;
}

function monthIndex(parts: Intl.DateTimeFormatPart[]): number {
  const month = parts.find((p) => p.type === "month");
  if (!month) return 0;
  const dtfMonthNames: Record<string, number> = {
    "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8,
    "01": 0, "02": 1, "03": 2, "04": 3, "05": 4, "06": 5, "07": 6, "08": 7, "09": 8,
    "10": 9, "11": 10, "12": 11
  };
  if (dtfMonthNames[month.value] !== undefined) return dtfMonthNames[month.value];
  const named: Record<string, number> = {
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7,
    September: 8, October: 9, November: 10, December: 11,
    janvier: 0, "février": 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, "août": 7,
    septembre: 8, octobre: 9, novembre: 10, "décembre": 11
  };
  return named[month.value] ?? 0;
}

let cachedDtf: Intl.DateTimeFormat | null = null;
function torontoDateTimeFormat(): Intl.DateTimeFormat {
  if (!cachedDtf) {
    cachedDtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: TORONTO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
  }
  return cachedDtf;
}

export interface TorontoParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

export function torontoParts(instant: Date): TorontoParts {
  const parts = torontoDateTimeFormat().formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second"))
  };
}

/** Normalize a pg date column (a Date) or a plain YYYY-MM-DD string to YYYY-MM-DD. */
export function dateToString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** Toronto calendar date of an instant, as YYYY-MM-DD. */
export function torontoDate(instant: Date): string {
  const p = torontoParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Toronto wall-clock representation of an instant, as YYYY-MM-DDTHH:MM (seconds dropped). */
export function torontoLocalMinute(instant: Date): string {
  const p = torontoParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type OffsetChoice = "first" | "reject";

export interface LocalToInstantResult {
  instant: Date | null;
  /** True when the requested local time falls in the spring-forward gap. */
  gap: boolean;
}

/**
 * Convert a Toronto wall-clock time to a UTC instant.
 * - In the fall-back hour the FIRST occurrence (daylight time) is chosen.
 * - In the spring-forward gap the result has gap=true and instant=null.
 */
export function torontoLocalToInstant(
  local: string,
  choice: OffsetChoice = "first"
): LocalToInstantResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return { instant: null, gap: false };
  const [, yS, moS, dS, hS, miS] = m;
  const y = Number(yS), mo = Number(moS), d = Number(dS), h = Number(hS), mi = Number(miS);
  const base = Date.UTC(y, mo - 1, d, h, mi);
  // Candidate offsets: try both DST and standard interpretations.
  // A local time exists iff some offset o maps it back to the same local fields.
  const candidates: number[] = [];
  for (const guess of [base - 5 * 3600000, base - 4 * 3600000, base - 4.5 * 3600000]) {
    const off = torontoOffsetMinutes(new Date(guess));
    if (!candidates.includes(off)) candidates.push(off);
  }
  const valid = candidates
    .map((off) => base - off * 60000)
    .filter((ms) => {
      const inst = new Date(ms);
      const p = torontoParts(inst);
      return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
    })
    .sort((a, b) => a - b);
  if (valid.length === 0) return { instant: null, gap: true };
  return { instant: new Date(choice === "first" ? valid[0] : valid[valid.length - 1]), gap: false };
}

/** Midnight Toronto (00:00) on the given YYYY-MM-DD, as a UTC instant. */
export function torontoMidnight(date: string): Date {
  return torontoLocalToInstant(`${date}T00:00`).instant!;
}

/** Toronto date-days arithmetic on YYYY-MM-DD strings. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateDiffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((da - db) / 86400000);
}

/** Add calendar months to YYYY-MM-DD, clamping to the month's last day. */
export function addMonths(date: string, months: number): string {
  const [yS, mS, dS] = date.split("-");
  const y = Number(yS), m = Number(mS), d = Number(dS);
  const targetYear = y + Math.floor((m - 1 + months) / 12);
  const targetMonth = (((m - 1 + months) % 12) + 12) % 12 + 1;
  const last = lastDayOfMonth(targetYear, targetMonth);
  const targetDay = Math.min(d, last);
  return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Next step in a bill-date series from an anchor: same day of month, else last day. */
export function nextInSeries(anchor: string, from: string, stepMonths: number): string {
  const anchorDay = Number(anchor.slice(8, 10));
  let candidate = addMonths(from, stepMonths);
  // Keep the series on the anchor's day when the month allows it.
  const [, mS] = candidate.split("-");
  const [y, m] = [Number(candidate.slice(0, 4)), Number(mS)];
  if (anchorDay <= lastDayOfMonth(y, m)) {
    candidate = `${candidate.slice(0, 8)}${pad2(anchorDay)}`;
  }
  return candidate;
}

/** The Toronto month (YYYY-MM) of an instant. */
export function torontoMonth(instant: Date): string {
  const d = torontoDate(instant);
  return d.slice(0, 7);
}

/** UTC instant of the start of a Toronto month (YYYY-MM). */
export function torontoMonthStart(month: string): Date {
  return torontoMidnight(`${month}-01`);
}

export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = y + Math.floor((m) / 12);
  const nm = (m % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}
