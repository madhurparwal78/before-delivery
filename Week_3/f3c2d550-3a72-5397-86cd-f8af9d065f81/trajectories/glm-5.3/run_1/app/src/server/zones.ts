// Local times in a home zone, the accepted zone list and the effective home zone
// (Business rules). Every local time uses the zone's own offset at that local
// moment; non-existent local times mean the first instant after the gap and
// doubled local times mean the earlier occurrence.

import { ZONE_NAMES } from "./zoneNames.js";

export interface ZoneEntry { zone: string; effective_from: number }

export const ZONES: string[] = ZONE_NAMES;

export function isAcceptedZone(name: string): boolean {
  return ZONES.includes(name);
}

// Offset (ms) of zone at the given instant.
export function zoneOffsetMs(zone: string, at: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUTC - Math.floor(at / 1000) * 1000;
}

// The instant of a local wall-clock time in the zone. If the local time does not
// exist, the first instant after the gap; if it occurs twice, the earlier one.
export function localToInstant(zone: string, y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetGuess = zoneOffsetMs(zone, guess);
  const probe = guess - offsetGuess;
  const offsetProbe = zoneOffsetMs(zone, probe);
  if (guess - offsetProbe === probe) return probe;
  // Gap: the first instant whose wall clock reaches the asked time.
  let t = probe;
  for (let step = 0; step < 24; step++) {
    if (t + zoneOffsetMs(zone, t) >= guess) return t;
    t += 15 * 60 * 1000;
  }
  return t;
}

// Local date parts of an instant in a zone.
export function localDate(zone: string, at: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

export function dateToYyyyMmDd(p: { y: number; mo: number; d: number }): string {
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function effectiveZone(history: ZoneEntry[], at: number): string {
  let current = history[0]?.zone ?? "UTC";
  for (const entry of history) {
    if (entry.effective_from <= at) current = entry.zone;
  }
  return current;
}

// Start of the current local date in the effective zone.
export function startOfDay(zone: string, at: number): number {
  const { y, mo, d } = localDate(zone, at);
  return localToInstant(zone, y, mo, d, 0, 0, 0);
}

// The next local midnight in the zone strictly after `at`, with the offset in
// force at that midnight.
export function nextLocalMidnight(zone: string, at: number): number {
  const { y, mo, d } = localDate(zone, at);
  const nextDay = new Date(Date.UTC(y, mo - 1, d + 1));
  return localToInstant(zone, nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, 0, 0);
}

// The pull day for an instant: the local date, minus one day before 06:00 local.
export function pullDayFor(zone: string, at: number): { y: number; mo: number; d: number } {
  const local = localDate(zone, at);
  if (local.h < 6 || (local.h === 6 && (local.mi > 0 || local.s > 0))) {
    const day = new Date(Date.UTC(local.y, local.mo - 1, local.d - 1));
    return { y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate() };
  }
  return { y: local.y, mo: local.mo, d: local.d };
}

export function pullDayKey(p: { y: number; mo: number; d: number }): string {
  return dateToYyyyMmDd(p);
}

// The next 06:00:00 local in the zone at or after `at`.
export function nextPullAt(zone: string, at: number): number {
  const local = localDate(zone, at);
  const today = localToInstant(zone, local.y, local.mo, local.d, 6, 0, 0);
  if (today >= at) return today;
  const next = new Date(Date.UTC(local.y, local.mo - 1, local.d + 1));
  return localToInstant(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6, 0, 0);
}
