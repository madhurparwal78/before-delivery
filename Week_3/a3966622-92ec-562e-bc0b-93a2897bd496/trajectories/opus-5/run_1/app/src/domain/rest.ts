import {
  HOUR_MS,
  dateKeyAt,
  dateKeyOf,
  instantToWall,
  minutesAfterMidnight,
  shiftDate,
  shiftDateKey,
} from './porttime.ts';

export type LicenceClass = 'A' | 'B' | 'C';

export const LICENCE_COVER: Record<LicenceClass, { length_m: number; draught_mm: number }> = {
  A: { length_m: 300, draught_mm: 13500 },
  B: { length_m: 230, draught_mm: 11500 },
  C: { length_m: 160, draught_mm: 8000 },
};

export type EligibilityReason = 'licence' | 'rest' | 'night_rest' | 'rota_days';

const REASON_ORDER: EligibilityReason[] = ['licence', 'rest', 'night_rest', 'rota_days'];

export const REST_TYPE_REASONS: EligibilityReason[] = ['rest', 'night_rest', 'rota_days'];

export type DutySpan = { start: number; end: number };

const LONG_DUTY_MS = 7 * HOUR_MS;
const LONG_DUTY_REST_MS = 10 * HOUR_MS;
const SHORT_DUTY_REST_MS = 6 * HOUR_MS;
const NIGHT_RUN_REST_MS = 12 * HOUR_MS;
const MAX_ROTA_DAYS = 15;

export function licenceCovers(
  licenceClass: LicenceClass,
  lengthM: number,
  draughtMm: number,
): boolean {
  const cover = LICENCE_COVER[licenceClass];
  return lengthM <= cover.length_m && draughtMm <= cover.draught_mm;
}

/** A boarding from 00:00 to 05:59 belongs to the previous date's night. */
function nightDateKey(start: number): string | null {
  const wall = instantToWall(start);
  const minutes = minutesAfterMidnight(wall);
  if (minutes >= 22 * 60) return dateKeyOf(wall);
  if (minutes <= 5 * 60 + 59) return dateKeyOf(shiftDate(wall, -1));
  return null;
}

/** The maximal run of consecutive date keys in the set that contains this key. */
function consecutiveRun(keys: ReadonlySet<string>, key: string): Set<string> {
  let first = key;
  while (keys.has(shiftDateKey(first, -1))) first = shiftDateKey(first, -1);
  const run = new Set<string>();
  for (let cursor = first; keys.has(cursor); cursor = shiftDateKey(cursor, 1)) run.add(cursor);
  return run;
}

/** Is this duty the third or later night duty on a run of consecutive nights? */
function thirdConsecutiveNight(duty: DutySpan, duties: readonly DutySpan[]): boolean {
  const nightKey = nightDateKey(duty.start);
  if (nightKey === null) return false;
  const nights = duties
    .map((span) => ({ span, key: nightDateKey(span.start) }))
    .filter((entry): entry is { span: DutySpan; key: string } => entry.key !== null);
  const run = consecutiveRun(new Set(nights.map((entry) => entry.key)), nightKey);
  const counted = nights.filter((entry) => run.has(entry.key) && entry.span.start <= duty.start);
  return counted.length >= 3;
}

function requiredRestAfter(
  duty: DutySpan,
  duties: readonly DutySpan[],
): { byLength: number; night: number | null } {
  const byLength = duty.end - duty.start >= LONG_DUTY_MS ? LONG_DUTY_REST_MS : SHORT_DUTY_REST_MS;
  return {
    byLength,
    night: thirdConsecutiveNight(duty, duties) ? NIGHT_RUN_REST_MS : null,
  };
}

function rotaRunLength(duties: readonly DutySpan[], prospective: DutySpan): number {
  const keys = new Set(duties.map((duty) => dateKeyAt(duty.start)));
  keys.add(dateKeyAt(prospective.start));
  return consecutiveRun(keys, dateKeyAt(prospective.start)).size;
}

export type RestVerdict = {
  reasons: EligibilityReason[];
  rest_until: number | null;
};

/** Rest must hold from the pilot's previous duty to this one and from this one to any later duty. */
export function restVerdict(existing: readonly DutySpan[], prospective: DutySpan): RestVerdict {
  const reasons = new Set<EligibilityReason>();
  const all = [...existing, prospective];
  let restUntil: number | null = null;

  for (const duty of existing) {
    if (duty.start < prospective.end && duty.end > prospective.start) reasons.add('rest');
  }

  let previous: DutySpan | null = null;
  for (const duty of existing) {
    if (duty.end <= prospective.start && (previous === null || duty.end > previous.end)) {
      previous = duty;
    }
  }
  if (previous !== null) {
    const required = requiredRestAfter(previous, all);
    const gap = prospective.start - previous.end;
    if (gap < required.byLength) reasons.add('rest');
    if (required.night !== null && gap < required.night) reasons.add('night_rest');
    restUntil = previous.end + Math.max(required.byLength, required.night ?? 0);
  }

  const requiredAfterThis = requiredRestAfter(prospective, all);
  for (const duty of existing) {
    if (duty.start < prospective.end) continue;
    const gap = duty.start - prospective.end;
    if (gap < requiredAfterThis.byLength) reasons.add('rest');
    if (requiredAfterThis.night !== null && gap < requiredAfterThis.night) reasons.add('night_rest');
  }

  if (rotaRunLength(existing, prospective) > MAX_ROTA_DAYS) reasons.add('rota_days');

  return {
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    rest_until: restUntil,
  };
}

/** The instant a pilot is rested again after their last duty, or null when they have none. */
export function nextAvailableInstant(duties: readonly DutySpan[]): number | null {
  let last: DutySpan | null = null;
  for (const duty of duties) {
    if (last === null || duty.end > last.end) last = duty;
  }
  if (last === null) return null;
  const required = requiredRestAfter(last, duties);
  return last.end + Math.max(required.byLength, required.night ?? 0);
}

export function sortReasons(reasons: readonly EligibilityReason[]): EligibilityReason[] {
  return REASON_ORDER.filter((reason) => reasons.includes(reason));
}
