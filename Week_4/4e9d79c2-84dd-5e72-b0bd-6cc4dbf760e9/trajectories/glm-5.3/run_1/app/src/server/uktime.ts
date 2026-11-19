const LONDON = "Europe/London";

function parts(instant: Date): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(instant)) o[p.type] = p.value;
  return o;
}

/** UK wall-clock fields of an instant: y, m, d, hh, mm, ss. */
export function ukFields(instant: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const o = parts(instant);
  return {
    y: Number(o.year),
    m: Number(o.month),
    d: Number(o.day),
    hh: Number(o.hour) === 24 ? 0 : Number(o.hour),
    mm: Number(o.minute),
    ss: Number(o.second),
  };
}

/** The UK calendar date of an instant as YYYY-MM-DD. */
export function ukDateString(instant: Date): string {
  const f = ukFields(instant);
  return pad(f.y) + "-" + pad(f.m) + "-" + pad(f.d);
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** The offset (ms) of Europe/London at the given instant. */
export function londonOffsetMs(instant: Date): number {
  const f = ukFields(instant);
  const asUtc = Date.UTC(f.y, f.m - 1, f.d, f.hh, f.mm, f.ss);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Convert UK wall time to an instant, honouring clock changes.
 * In a repeated hour, the first occurrence is used unless `second` is true.
 * In a missing hour returns null. */
export function ukToInstant(
  date: string,
  time: string,
  second = false
): { instant: Date; exists: boolean; repeated: boolean } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Try each offset within ±2h of the target UTC day; find candidates whose UK wall fields match.
  const base = Date.UTC(y, m - 1, d, hh, mm, 0);
  const candidates: Date[] = [];
  for (let off = -3; off <= 3; off++) {
    const t = new Date(base + off * 3600000);
    const f = ukFields(t);
    if (f.y === y && f.m === m && f.d === d && f.hh === hh && f.mm === mm && f.ss === 0) candidates.push(t);
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  if (candidates.length === 0) return { instant: new Date(NaN), exists: false, repeated: false };
  const pick = second && candidates.length > 1 ? candidates[1] : candidates[0];
  return { instant: pick, exists: true, repeated: candidates.length > 1 };
}

/** Does the given UK date hold a forward clock change (01:00-01:59 missing)? */
export function isMissingHourDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const midnight = new Date(Date.UTC(y, m - 1, d, 0));
  return londonOffsetMs(noon) > londonOffsetMs(midnight);
}

/** Does the given UK date hold a backward clock change (01:00-01:59 repeated)? */
export function isRepeatedHourDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const midnight = new Date(Date.UTC(y, m - 1, d, 0));
  return londonOffsetMs(noon) < londonOffsetMs(midnight);
}

export function isDSTGapTime(date: string, time: string): boolean {
  if (!isMissingHourDate(date)) return false;
  const r = ukToInstant(date, time);
  return !r.exists;
}

export function isRepeatedTime(date: string, time: string): boolean {
  if (!isRepeatedHourDate(date)) return false;
  const r = ukToInstant(date, time);
  return r.repeated;
}

/** Calendar day difference in UK dates between two instants. */
export function ukDayDiff(a: Date, b: Date): number {
  const da = Number(ukDateString(a).replace(/-/g, ""));
  const db = Number(ukDateString(b).replace(/-/g, ""));
  return dayNumber(db) - dayNumber(da);
}

function dayNumber(yyyymmdd: number): number {
  const y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor((yyyymmdd % 1000) / 100);
  const d = yyyymmdd % 100;
  return daysFromCivil(y, m, d);
}

function daysFromCivil(y: number, m: number, d: number): number {
  y += m <= 2 ? -1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** A specific UK calendar date as YYYY-MM-DD from y/m/d numbers. */
export function dateKey(y: number, m: number, d: number): string {
  return pad(y) + "-" + pad(m) + "-" + pad(d);
}

/** Day-of-week (0=Sunday..6=Saturday) for a UK date. */
export function ukDayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function civilFromDayNumber(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** Add calendar days to a UK date, returning YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const n = daysFromCivil(y, m, d) + days;
  const c = civilFromDayNumber(n);
  return dateKey(c.y, c.m, c.d);
}

/** Whole seconds elapsed from a to b, negative if a after b. */
export function secondsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 1000);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export const MAX_INSTANT = new Date(8640000000000000);
