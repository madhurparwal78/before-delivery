// The single place that turns a local wall-clock time in a zone into an instant,
// with the one published clock-change rule:
//  - a local time that does not exist (spring gap) moves forward by the gap length
//  - a local time that happens twice (autumn fold) means its first occurrence

export interface Wall {
  y: number; // 1-12
  m: number;
  d: number; // 1-31
}

export interface WallTime extends Wall {
  hh: number; // 0-23
  mm: number; // 0-59
}

const partCache = new Map<string, { parts: Intl.DateTimeFormatPart[]; fmt: Intl.DateTimeFormat }>();

function formatter(tz: string): Intl.DateTimeFormat {
  let e = partCache.get(tz);
  if (!e) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    e = { parts: [], fmt };
    partCache.set(tz, e);
  }
  return e.fmt;
}

/** Wall-clock parts of an instant in a zone. hour is 0-23 (24 becomes 0). */
export function wallParts(tz: string, t: number): WallTime & { ss: number } {
  const parts = formatter(tz).formatToParts(t);
  let y = 0, m = 0, d = 0, hh = 0, mm = 0, ss = 0;
  for (const p of parts) {
    if (p.type === "year") y = Number(p.value);
    else if (p.type === "month") m = Number(p.value);
    else if (p.type === "day") d = Number(p.value);
    else if (p.type === "hour") hh = Number(p.value);
    else if (p.type === "minute") mm = Number(p.value);
    else if (p.type === "second") ss = Number(p.value);
  }
  if (hh === 24) hh = 0;
  return { y, m, d, hh, mm, ss };
}

function wallMs(w: WallTime): number {
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
}

/** Zone offset in minutes east of UTC (Chicago CDT = -300). */
export function offsetAt(tz: string, t: number): number {
  const p = wallParts(tz, t);
  return (wallMs(p) - t) / 60000;
}

/**
 * Resolve a local wall time in a zone to its instant (epoch ms).
 * Uses the fixed-point probe described in the domain: try the offset before and
 * after the naive instant; a match means a real local time; no match means the
 * spring gap, which resolves forward by the gap length.
 */
export function resolveWallTime(tz: string, w: WallTime): number {
  const naive = wallMs(w);
  // Probe 1: offset at the naive instant treated as UTC.
  let inst = naive - offsetAt(tz, naive) * 60000;
  if (wallMs(wallParts(tz, inst)) === naive) {
    // Real, or the first of two occurrences. For a folded time the offset at the
    // naive instant is the pre-transition offset only when the naive instant falls
    // before the transition; the probe then lands on the earlier occurrence.
    // Verify it is the earlier one by checking the other candidate.
    const later = naive - offsetAt(tz, inst + 6 * 3600000) * 60000;
    if (later !== inst && wallMs(wallParts(tz, later)) === naive && later < inst) return later;
    return inst;
  }
  // Probe 2: offset an hour away (covers zones whose transition sits between).
  inst = naive - offsetAt(tz, naive + 6 * 3600000) * 60000;
  if (wallMs(wallParts(tz, inst)) === naive) {
    const earlier = naive - offsetAt(tz, inst - 6 * 3600000) * 60000;
    if (earlier !== inst && wallMs(wallParts(tz, earlier)) === naive && earlier < inst) return earlier;
    return inst;
  }
  // Gap: local time does not exist. Resolve forward by the gap: take the offset
  // before the transition (larger UTC distance) and land after the gap.
  const before = naive - offsetAt(tz, naive - 6 * 3600000) * 60000;
  return before;
}

/** Zone abbreviation at an instant, e.g. CDT. */
export function zoneAbbr(tz: string, t: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
  const parts = fmt.formatToParts(t);
  for (const p of parts) if (p.type === "timeZoneName") return p.value;
  return "";
}

/** Length in minutes of a local date (1380, 1440 or 1500). */
export function dayMinutes(tz: string, date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const start = resolveWallTime(tz, { y, m, d, hh: 0, mm: 0 });
  const nextDay = new Date(Date.UTC(y, m - 1, d) + 86400000);
  const end = resolveWallTime(tz, {
    y: nextDay.getUTCFullYear(), m: nextDay.getUTCMonth() + 1, d: nextDay.getUTCDate(), hh: 0, mm: 0,
  });
  return Math.round((end - start) / 60000);
}

/** Hour ticks of a local date: the local hour labels that exist that day. */
export function dayTicks(tz: string, date: string): { at: string; label: string; zone: string }[] {
  const [y, m, d] = date.split("-").map(Number);
  const start = resolveWallTime(tz, { y, m, d, hh: 0, mm: 0 });
  const end = start + dayMinutes(tz, date) * 60000;
  const ticks: { at: string; label: string; zone: string }[] = [];
  for (let t = start; t < end; t += 3600000) {
    const p = wallParts(tz, t);
    ticks.push({
      at: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"),
      label: `${String(p.hh).padStart(2, "0")}:00`,
      zone: zoneAbbr(tz, t),
    });
  }
  return ticks;
}

/** The local date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(tz: string, t: number): string {
  const p = wallParts(tz, t);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Every local date a [start,end) instant range touches in a zone. */
export function datesTouched(tz: string, start: number, end: number): string[] {
  const out: string[] = [];
  let t = start;
  const last = Math.min(end - 1, start + 1500 * 60000);
  while (t <= last) {
    const d = localDate(tz, t);
    if (out[out.length - 1] !== d) out.push(d);
    t += 3600000 * 6;
    if (out.length > 4) break;
  }
  if (out[out.length - 1] !== localDate(tz, last)) out.push(localDate(tz, last));
  return out;
}

/** Every local date the whole closed range touches, covering multi-hour spans. */
export function rangeDates(tz: string, start: number, end: number): string[] {
  const set = new Set<string>();
  set.add(localDate(tz, start));
  set.add(localDate(tz, end - 1));
  return [...set].sort();
}

export function localTimeStr(t: number): string {
  return `T${String(t).padStart(2, "0")}`;
}

/** "YYYY-MM-DD HH:MM <zone>" for an instant in a zone. */
export function localStamp(tz: string, t: number): string {
  const p = wallParts(tz, t);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} ${zoneAbbr(tz, t)}`;
}

export function hhmmOf(tz: string, t: number): string {
  const p = wallParts(tz, t);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

export const iso = (t: number): string => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

export const parseIso = (s: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return NaN;
  return Date.parse(s);
};

/** Add n days to a YYYY-MM-DD date string. */
export function addDaysStr(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
export const isTime = (s: string): boolean => /^\d{2}:\d{2}$/.test(s) && s >= "00:00" && s <= "24:00";
