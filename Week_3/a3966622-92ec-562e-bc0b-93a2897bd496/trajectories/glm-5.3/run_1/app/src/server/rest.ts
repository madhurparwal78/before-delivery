import { dutyDate, isNightBoarding } from './porttime.js';

// Pilot licence classes, duties, rest verdicts and turn order. All hours are
// real elapsed time.

export interface LicenceClass {
  code: 'A' | 'B' | 'C';
  max_length_m: number;
  max_draught_mm: number;
}

export const LICENCE_CLASSES: readonly LicenceClass[] = [
  { code: 'A', max_length_m: 300, max_draught_mm: 13500 },
  { code: 'B', max_length_m: 230, max_draught_mm: 11500 },
  { code: 'C', max_length_m: 160, max_draught_mm: 8000 },
];

export function licenceOf(code: string): LicenceClass {
  const found = LICENCE_CLASSES.find((c) => c.code === code);
  if (!found) throw new Error(`unknown licence class ${code}`);
  return found;
}

export function licenceCovers(code: string, lengthM: number, draughtMm: number): boolean {
  const cls = licenceOf(code);
  return lengthM <= cls.max_length_m && draughtMm <= cls.max_draught_mm;
}

// A seeded or move duty: a span of real time from boarding for duty minutes,
// ending at completion or refusal when it happened. An open duty has not ended.
export interface DutyRecord {
  startMs: number;
  endMs: number;
  open: boolean;
}

export type RestReason = 'licence' | 'rest' | 'night_rest' | 'rota_days';

export interface EligibilityTarget {
  lengthM: number;
  draughtMm: number;
  boardingMs: number;
  dutyMinutes: number;
}

const MIN_REST_LONG_MS = 10 * 3600_000;
const MIN_REST_SHORT_MS = 6 * 3600_000;
const LONG_DUTY_MS = 7 * 3600_000;
const NIGHT_REST_MS = 12 * 3600_000;
const MAX_ROTA_DAYS = 15;

function restAfter(dutyMs: number): number {
  return dutyMs >= LONG_DUTY_MS ? MIN_REST_LONG_MS : MIN_REST_SHORT_MS;
}

export function plannedEndMs(target: EligibilityTarget): number {
  return target.boardingMs + target.dutyMinutes * 60_000;
}

// The rest and rota verdict for one pilot against one target assignment.
export function reasonsFor(
  pilotClassCode: string,
  duties: readonly DutyRecord[],
  target: EligibilityTarget,
): RestReason[] {
  const reasons: RestReason[] = [];
  if (!licenceCovers(pilotClassCode, target.lengthM, target.draughtMm)) reasons.push('licence');

  const plannedStart = target.boardingMs;
  const plannedEnd = plannedEndMs(target);
  const plannedDutyMs = plannedEnd - plannedStart;

  // Rest: at least 10 hours after a duty of 7 hours or more, at least 6 after a
  // shorter one, holding both from the previous duty to this one and from this
  // one to any later duty. Exactly the minimum is allowed.
  const lastEarlierEnd = duties
    .filter((d) => !d.open && d.endMs <= plannedStart)
    .reduce((acc, d) => Math.max(acc, d.endMs), Number.NEGATIVE_INFINITY);
  const firstLaterStart = duties
    .filter((d) => !d.open && d.startMs >= plannedEnd)
    .reduce((acc, d) => Math.min(acc, d.startMs), Number.POSITIVE_INFINITY);
  const overlap = duties.some((d) => !d.open && d.startMs < plannedEnd && d.endMs > plannedStart);
  const earlierOk =
    !Number.isFinite(lastEarlierEnd) ||
    plannedStart - lastEarlierEnd >= restAfter(largestEarlierDutyMs(duties, lastEarlierEnd, plannedStart));
  const laterOk = !Number.isFinite(firstLaterStart) || firstLaterStart - plannedEnd >= restAfter(plannedDutyMs);
  if (overlap || !earlierOk || !laterOk || duties.some((d) => d.open)) reasons.push('rest');

  // Night rest: a night duty is one whose port-local boarding time falls in the
  // night window, and a boarding from 00:00 to 05:59 belongs to the previous
  // date's night. At least 12 hours of rest follow the third or later night
  // duty on consecutive nights.
  const plannedNight = isNightBoarding(target.boardingMs);
  const nightDates = [...new Set(duties.filter((d) => isNightBoarding(d.startMs)).map((d) => dutyDate(d.startMs)))].sort();
  if (plannedNight) {
    const run = nightsBefore(nightDates, dutyDate(target.boardingMs));
    if (run >= 2) reasons.push('night_rest');
  } else {
    const thirdOrLater = nightRunEndingAt(nightDates) >= 3;
    const breaksTwelveHours = duties.some(
      (d) => d.startMs >= plannedEnd && d.startMs - plannedEnd < NIGHT_REST_MS && isNightBoarding(d.startMs) === false,
    );
    if (thirdOrLater && breaksTwelveHours) reasons.push('night_rest');
    const laterNights = duties.filter((d) => d.startMs > plannedEnd && isNightBoarding(d.startMs));
    if (thirdOrLater && laterNights.length > 0) reasons.push('night_rest');
  }

  // Rota days: a run of consecutive port-local duty dates may not exceed 15.
  const dates = [...new Set([...duties.map((d) => dutyDate(d.startMs)), dutyDate(target.boardingMs)])].sort();
  let maxRun = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of dates) {
    run = prev !== null && nextDate(prev) === date ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
    prev = date;
  }
  if (maxRun > MAX_ROTA_DAYS) reasons.push('rota_days');

  return reasons;
}

// The longest duty among those ending at or before the planned start.
function largestEarlierDutyMs(duties: readonly DutyRecord[], lastEarlierEnd: number, plannedStart: number): number {
  const earlier = duties.filter((d) => !d.open && d.endMs <= plannedStart && d.endMs === lastEarlierEnd);
  return earlier.reduce((acc, d) => Math.max(acc, d.endMs - d.startMs), 0);
}

// Number of consecutive nights immediately before the target night date.
function nightsBefore(nightDates: readonly string[], targetDate: string): number {
  let run = 0;
  let cursor = targetDate;
  for (;;) {
    cursor = shiftBack(cursor);
    if (nightDates.includes(cursor)) run++;
    else break;
  }
  return run;
}

function nightRunEndingAt(nightDates: readonly string[]): number {
  let max = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of nightDates) {
    run = prev !== null && nextDate(prev) === date ? run + 1 : 1;
    max = Math.max(max, run);
    prev = date;
  }
  return max;
}

export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

export function shiftBack(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}
