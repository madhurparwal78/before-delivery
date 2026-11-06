/** Rate versions: their effective instant, their status at an instant, and the version a block bills at. */
import { minutesOfDay, weekdayOf, type WeekdayKey } from '../../shared/calendar.js';

export type RateStatus = 'past' | 'current' | 'scheduled';

export type RateVersion = {
  id: string;
  stationId: string;
  effectiveFrom: string;
  effectiveAtMs: number;
  offPeakHourlyCents: number | null;
  peakHourlyCents: number | null;
  shelfDayCents: number | null;
};

export type PeakWindow = { days: WeekdayKey[]; start: string; end: string };

/**
 * The latest version whose effective instant is at or before the instant. A
 * station always has its seeded first version, which is used for any instant
 * before it.
 */
export function versionAt(versions: RateVersion[], instantMs: number): RateVersion {
  const ascending = [...versions].sort((a, b) => a.effectiveAtMs - b.effectiveAtMs);
  let found = ascending[0]!;
  for (const version of ascending) {
    if (version.effectiveAtMs <= instantMs) found = version;
  }
  return found;
}

export function statusAt(
  versions: RateVersion[],
  version: RateVersion,
  nowMs: number,
): RateStatus {
  if (version.effectiveAtMs > nowMs) return 'scheduled';
  const current = versions
    .filter((candidate) => candidate.effectiveAtMs <= nowMs)
    .reduce<RateVersion | null>(
      (latest, candidate) =>
        !latest || candidate.effectiveAtMs > latest.effectiveAtMs ? candidate : latest,
      null,
    );
  return current && current.id === version.id ? 'current' : 'past';
}

/** The quarter hours of an hourly block that fall inside a peak window. */
export function peakQuarters(
  date: string,
  localStart: string,
  localEnd: string,
  windows: PeakWindow[],
): number {
  const weekday = weekdayOf(date);
  const startMinutes = minutesOfDay(localStart);
  const endMinutes = minutesOfDay(localEnd);
  let count = 0;
  for (let minute = startMinutes; minute < endMinutes; minute += 15) {
    if (isPeakMinute(weekday, minute, windows)) count += 1;
  }
  return count;
}

function isPeakMinute(weekday: WeekdayKey, minute: number, windows: PeakWindow[]): boolean {
  for (const window of windows) {
    if (!window.days.includes(weekday)) continue;
    if (minute >= minutesOfDay(window.start) && minute < minutesOfDay(window.end)) return true;
  }
  return false;
}

/** Half away from zero, on integers only. */
function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  return sign * Math.floor((absolute * 2 + denominator) / (denominator * 2));
}

export function hourlyChargeCents(
  quarters: number,
  peak: number,
  offPeakHourlyCents: number,
  peakHourlyCents: number,
): number {
  const offPeak = quarters - peak;
  return roundHalfAwayFromZero(peak * peakHourlyCents + offPeak * offPeakHourlyCents, 4);
}

export function shelfChargeCents(days: number, shelfDayCents: number): number {
  return days * shelfDayCents;
}

export function halfOf(cents: number): number {
  return roundHalfAwayFromZero(cents, 2);
}
