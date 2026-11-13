export const DAY_MS = 86400000;

/** Parse a YYYY-MM-DD string strictly; returns null when invalid. */
export function parseDate(s: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function toDate(s: string): Date | null {
  const p = parseDate(s);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null;
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function nightsBetween(inIso: string, outIso: string): number {
  const a = toDate(inIso), b = toDate(outIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function eachNight(inIso: string, outIso: string): string[] {
  const out: string[] = [];
  const a = toDate(inIso), b = toDate(outIso);
  if (!a || !b) return out;
  for (let d = new Date(a); d < b; d = addDays(d, 1)) out.push(iso(d));
  return out;
}

/** Whole calendar days between two date strings (b - a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = toDate(aIso), b = toDate(bIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** The calendar date of an instant in an IANA zone. */
export function zoneDate(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts;
}

/** Weekday index in the published numbering: 1 Monday … 7 Sunday. */
export function weekdayIndex(dateIso: string): number {
  const d = toDate(dateIso)!;
  const dow = d.getUTCDay(); // 0 Sunday
  return dow === 0 ? 7 : dow;
}

export const WEEKDAY_LETTERS = "MTWTFSS";

export function monthStart(dateIso: string): string {
  return dateIso.slice(0, 8) + "01";
}

export function nextMonth(dateIso: string): string {
  const y = +dateIso.slice(0, 4), m = +dateIso.slice(5, 7);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Months from (inclusive) to (exclusive) as yyyy-mm strings. */
export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  let y = +fromYm.slice(0, 4), m = +fromYm.slice(5, 7);
  const ty = +toYm.slice(0, 4), tm = +toYm.slice(5, 7);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out;
}
