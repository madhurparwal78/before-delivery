import { addDays, clockFor, daysBetween } from './timezones.js';

export const BEDTIME_MIN = '20:00';
export const BEDTIME_MAX = '23:59';
export const CAPTURE_CLOSE_HM = '14:00';
export const CAPTURE_WINDOW_HOURS = 5;
export const NIGHTS_PER_COHORT = 28;
export const TECHNIQUE_NIGHT = 8;

export function wakeAlarmFor(bedtime: string): string {
  const parts = bedtime.split(':');
  const h = Number(parts[0] ?? '0');
  const m = Number(parts[1] ?? '0');
  const total = h * 60 + m + CAPTURE_WINDOW_HOURS * 60;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// The derived key: local date at the moment of the request, minus one day
// when the local time of day is before the bedtime.
export function derivedNightKey(now: Date, homeTz: string, bedtime: string): string {
  const clock = clockFor(homeTz);
  const ymd = clock.ymd(now);
  const hm = clock.hm(now);
  return hm < bedtime ? addDays(ymd, -1) : ymd;
}

export interface NightSnapshot {
  night_key: string;
  night_number: number;
  capture_window: 'open' | 'closed';
}

// The published night key is the later of the derived key and the dreamer's
// latest stored entry's night key. It never moves earlier.
export function nightKeyFor(now: Date, homeTz: string, bedtime: string, latestStoredKey: string | null): string {
  const derived = derivedNightKey(now, homeTz, bedtime);
  if (latestStoredKey !== null && latestStoredKey > derived) return latestStoredKey;
  return derived;
}

export function nightNumberFor(nightKey: string, firstNight: string | null): number {
  if (firstNight === null) return 0;
  return daysBetween(firstNight, nightKey) + 1;
}

// The capture window of the current night closes at 14:00 local time on the
// day after its night key.
export function captureWindowStatus(now: Date, homeTz: string, nightKey: string): 'open' | 'closed' {
  const clock = clockFor(homeTz);
  const closeDay = addDays(nightKey, 1);
  const closesAt = clock.dateAtLocal(closeDay, CAPTURE_CLOSE_HM);
  return now.getTime() < closesAt.getTime() ? 'open' : 'closed';
}

export function isLateRecall(now: Date, homeTz: string, nightKey: string): boolean {
  return captureWindowStatus(now, homeTz, nightKey) === 'closed';
}

export function snapshotFor(now: Date, homeTz: string, bedtime: string, firstNight: string | null, latestStoredKey: string | null): NightSnapshot {
  const nightKey = nightKeyFor(now, homeTz, bedtime, latestStoredKey);
  return {
    night_key: nightKey,
    night_number: nightNumberFor(nightKey, firstNight),
    capture_window: captureWindowStatus(now, homeTz, nightKey),
  };
}
