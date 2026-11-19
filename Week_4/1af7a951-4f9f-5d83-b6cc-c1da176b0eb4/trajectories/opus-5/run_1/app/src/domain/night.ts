import {
  addDays,
  daysBetween,
  localMoment,
  minutesOfTime,
  timeOfMinutes,
  type DateKey,
} from './time.js';

export const NIGHTS_PER_COHORT = 28;
export const TECHNIQUE_UNLOCK_NIGHT = 8;
const CAPTURE_WINDOW_CLOSES_AT = 14 * 60;

export interface NightSettings {
  readonly homeTz: string;
  readonly bedtime: string;
}

export function wakeAlarm(bedtime: string): string {
  return timeOfMinutes(minutesOfTime(bedtime) + 5 * 60);
}

export function derivedNightKey(settings: NightSettings, now: Date): DateKey {
  const local = localMoment(now, settings.homeTz);
  return local.minutesOfDay >= minutesOfTime(settings.bedtime)
    ? local.dateKey
    : addDays(local.dateKey, -1);
}

export function publishedNightKey(
  settings: NightSettings,
  now: Date,
  latestStoredNightKey: DateKey | null,
): DateKey {
  const derived = derivedNightKey(settings, now);
  if (latestStoredNightKey !== null && latestStoredNightKey > derived) return latestStoredNightKey;
  return derived;
}

export function nightHeld(
  settings: NightSettings,
  now: Date,
  publishedKey: DateKey,
): boolean {
  return derivedNightKey(settings, now) < publishedKey;
}

export function nightNumber(nightKey: DateKey, firstNight: DateKey | null): number {
  if (firstNight === null) return 0;
  const number = daysBetween(firstNight, nightKey) + 1;
  return number < 0 ? 0 : number;
}

export function captureWindowOpen(
  nightKey: DateKey,
  settings: NightSettings,
  now: Date,
): boolean {
  const local = localMoment(now, settings.homeTz);
  const closesOn = addDays(nightKey, 1);
  if (local.dateKey < closesOn) return true;
  if (local.dateKey > closesOn) return false;
  return local.minutesOfDay < CAPTURE_WINDOW_CLOSES_AT;
}

export function techniqueUnlocked(currentNightNumber: number): boolean {
  return currentNightNumber >= TECHNIQUE_UNLOCK_NIGHT;
}
