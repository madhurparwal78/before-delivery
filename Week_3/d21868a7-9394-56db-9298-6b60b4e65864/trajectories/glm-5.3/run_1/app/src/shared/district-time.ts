// District time: Australia/Sydney instants, the API instant format, window
// labels with the repeated-hour zone mark, and district-date periods.

export const DISTRICT_ZONE = "Australia/Sydney";

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// Australia/Sydney DST rules (standardised time). NSW observes DST from the
// first Sunday in October 02:00 local standard to the first Sunday in April
// 03:00 local daylight. We compute the offset by locating the transitions in
// UTC for the year around the instant, which is exact for all seeded and
// user-created dates and needs no tz database.

const SYD_STD_MIN = 10 * 60; // AEST UTC+10
const SYD_DST_MIN = 11 * 60; // AEDT UTC+11

// first Sunday of a given month in a given year, as UTC ms for 00:00 local
function firstSundayUTC(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month, 1));
  const day = d.getUTCDay();
  const shift = (7 - day) % 7;
  return Date.UTC(year, month, 1 + shift);
}

// offset in minutes east of UTC that applies at the given UTC instant
export function districtOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  // October transition: first Sunday of October at 02:00 AEST => UTC 16:00
  const octTransition = firstSundayUTC(year, 9) + 2 * HOUR_MS - SYD_STD_MIN * MINUTE_MS;
  // April transition: first Sunday of April at 03:00 AEDT => UTC 16:00
  const aprTransition = firstSundayUTC(year, 3) + 3 * HOUR_MS - SYD_DST_MIN * MINUTE_MS;
  // DST interval: from Oct transition to Apr transition of the next year.
  // For an instant in Jan-Mar, the relevant October is the previous year's.
  if (utcMs >= aprTransition && utcMs < octTransition) return SYD_STD_MIN;
  return SYD_DST_MIN;
}

// local parts in the district zone
export function districtLocalParts(utcMs: number): { year: number; month: number; day: number; hours: number; minutes: number; seconds: number; offsetMinutes: number } {
  const local = utcMs + districtOffsetMinutes(utcMs) * MINUTE_MS;
  const d = new Date(local);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    offsetMinutes: districtOffsetMinutes(utcMs),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localClock(districtParts: ReturnType<typeof districtLocalParts>): string {
  return `${pad2(districtParts.hours)}:${pad2(districtParts.minutes)}`;
}

// The zone mark for an instant in April's repeated hour: " AEDT" on the first
// pass, " AEST" on the second. Local readings 02:00-02:59 occur twice around
// the DST-end transition T (03:00 AEDT -> 02:00 AEST): once on [T-1h, T) under
// AEDT, and again on [T, T+1h) under AEST. No other instant carries a mark.
function repeatedHourMark(utcMs: number): string {
  const p = districtLocalParts(utcMs);
  if (p.hours !== 2) return "";
  if (p.offsetMinutes === SYD_DST_MIN) {
    const t = dstEndTransition(p.year);
    if (utcMs >= t - HOUR_MS && utcMs < t) return " AEDT";
    return "";
  }
  if (p.offsetMinutes === SYD_STD_MIN) {
    const t = dstEndTransition(p.year);
    if (utcMs >= t && utcMs < t + HOUR_MS) return " AEST";
    return "";
  }
  return "";
}

// the UTC instant of the DST-end transition (first Sunday in April, 03:00 AEDT)
function dstEndTransition(year: number): number {
  return firstSundayUTC(year, 3) + 3 * HOUR_MS - SYD_DST_MIN * MINUTE_MS;
}

// One instant's label part: `Ddd D Mon HH:MM` plus ` AEDT` in the repeated hour
export function labelPart(utcMs: number): string {
  const p = districtLocalParts(utcMs);
  const dayName = DAYS[new Date(utcMs + offsetOf(utcMs)).getUTCDay()];
  const local = `${dayName} ${p.day} ${MONTHS[p.month]} ${localClock(p)}`;
  return `${local}${repeatedHourMark(utcMs)}`;
}

function offsetOf(utcMs: number): number {
  return districtOffsetMinutes(utcMs) * MINUTE_MS;
}

// full window label
export function windowLabel(opensAtMs: number, closesAtMs: number): string {
  return `${labelPart(opensAtMs)} to ${labelPart(closesAtMs)}`;
}

// The API instant format: YYYY-MM-DDTHH:MM:SSZ
export function formatInstant(ms: number): string {
  const d = new Date(Math.trunc(ms / 1000) * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
}

export function parseInstant(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  if (Number.isNaN(d.getTime())) return null;
  if (formatInstant(d.getTime()) !== text) return null;
  return d.getTime();
}

export function truncateToSecond(ms: number): number {
  return Math.trunc(ms / 1000) * 1000;
}

export function truncateToMinute(ms: number): number {
  return Math.trunc(ms / MINUTE_MS) * MINUTE_MS;
}

// district date YYYY-MM-DD for the instant
export function districtDate(ms: number): string {
  const p = districtLocalParts(ms);
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

export function parseDistrictDate(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  // local midnight of that district date: find the UTC instant whose local
  // date equals this date at 00:00 local.
  const guess = Date.UTC(y, mo - 1, d, 0) - SYD_STD_MIN * MINUTE_MS;
  for (let off = 0; off < 2; off++) {
    const candidate = guess + off * HOUR_MS;
    const p2 = districtLocalParts(candidate);
    if (p2.year === y && p2.month === mo - 1 && p2.day === d && p2.hours === 0 && p2.minutes === 0) return candidate;
  }
  // DST-start day 00:00 local is 13:00Z previous UTC day; recompute directly
  const asUTC = Date.UTC(y, mo - 1, d, 0);
  const off = districtOffsetMinutes(asUTC - 10 * HOUR_MS);
  const candidate = asUTC - off * MINUTE_MS;
  const p3 = districtLocalParts(candidate);
  if (p3.year === y && p3.month === mo - 1 && p3.day === d && p3.hours === 0 && p3.minutes === 0) return candidate;
  return null;
}

export function districtDateToUTCStart(text: string): number | null {
  return parseDistrictDate(text);
}

// inclusive day count between two district dates
export function districtDateSpanDays(fromMs: number, toMs: number): number {
  const f = districtLocalParts(fromMs);
  const t = districtLocalParts(toMs);
  const fd = Date.UTC(f.year, f.month, f.day);
  const td = Date.UTC(t.year, t.month, t.day);
  return Math.round((td - fd) / DAY_MS) + 1;
}

export function addDistrictDays(ms: number, days: number): number {
  const p = districtLocalParts(ms);
  return ms + days * DAY_MS;
}

export { MONTHS, DAYS, pad2, SYD_DST_MIN, SYD_STD_MIN, HOUR_MS, MINUTE_MS, DAY_MS };
