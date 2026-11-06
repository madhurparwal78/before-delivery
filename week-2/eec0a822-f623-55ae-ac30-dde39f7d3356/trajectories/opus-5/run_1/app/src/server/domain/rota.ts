import type { RestRule } from '../../shared/copy.js';
import { addDays, localDate, localTime, startOfLocalDay } from '../../shared/zone.js';

export const SLOT_MS = 1_800_000;
const SLOTS_PER_DAY = 48;
const SLOTS_PER_WEEK_WINDOW = 336;
const MIN_REST_SLOTS_24H = 20; // 10 hours
const MIN_REST_SLOTS_168H = 154; // 77 hours
const MAX_WORK_RUN_SLOTS = 28; // 14 hours
const MIN_LONG_REST_SLOTS = 12; // 6 hours

export interface RotaSlot {
  readonly startsAt: Date;
  readonly date: string;
  readonly label: string;
}

export function weekSlots(zone: string, weekStart: string): RotaSlot[] {
  const start = startOfLocalDay(zone, weekStart).getTime();
  const end = startOfLocalDay(zone, addDays(weekStart, 7)).getTime();
  const slots: RotaSlot[] = [];
  const seenByDate = new Map<string, Set<string>>();
  for (let time = start; time < end; time += SLOT_MS) {
    const startsAt = new Date(time);
    const date = localDate(zone, startsAt);
    const clock = localTime(zone, startsAt);
    let seen = seenByDate.get(date);
    if (seen === undefined) {
      seen = new Set<string>();
      seenByDate.set(date, seen);
    }
    const repeated = seen.has(clock);
    seen.add(clock);
    slots.push({ startsAt, date, label: repeated ? `${clock} (repeat)` : clock });
  }
  return slots;
}

export interface RestRuleBreach {
  readonly rule: RestRule;
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

function windowEnd(slots: readonly RotaSlot[], index: number, length: number): Date {
  const last = index + length - 1;
  if (last < slots.length) return new Date(slots[last].startsAt.getTime() + SLOT_MS);
  const overshoot = last - (slots.length - 1);
  return new Date(slots[slots.length - 1].startsAt.getTime() + SLOT_MS + overshoot * SLOT_MS);
}

function restCountInWindow(work: readonly boolean[], index: number, length: number): number {
  let rest = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const slot = index + offset;
    if (slot >= work.length || !work[slot]) rest += 1;
  }
  return rest;
}

/** The one rest-rule check: the first rule a crew member's week breaks, with its earliest window. */
export function findRestRuleBreach(
  slots: readonly RotaSlot[],
  work: readonly boolean[],
): RestRuleBreach | null {
  const gap = findLongWorkRun(slots, work);
  if (gap !== null) return gap;

  for (let index = 0; index < slots.length; index += 1) {
    if (restCountInWindow(work, index, SLOTS_PER_DAY) < MIN_REST_SLOTS_24H) {
      return {
        rule: 'min_rest_24h',
        windowStart: slots[index].startsAt,
        windowEnd: windowEnd(slots, index, SLOTS_PER_DAY),
      };
    }
  }

  for (let index = 0; index < slots.length; index += 1) {
    if (restCountInWindow(work, index, SLOTS_PER_WEEK_WINDOW) < MIN_REST_SLOTS_168H) {
      return {
        rule: 'min_rest_168h',
        windowStart: slots[index].startsAt,
        windowEnd: windowEnd(slots, index, SLOTS_PER_WEEK_WINDOW),
      };
    }
  }

  for (let index = 0; index < slots.length; index += 1) {
    if (!hasAllowedRestPeriods(work, index)) {
      return {
        rule: 'rest_periods_24h',
        windowStart: slots[index].startsAt,
        windowEnd: windowEnd(slots, index, SLOTS_PER_DAY),
      };
    }
  }
  return null;
}

function findLongWorkRun(
  slots: readonly RotaSlot[],
  work: readonly boolean[],
): RestRuleBreach | null {
  let runStart = -1;
  for (let index = 0; index <= slots.length; index += 1) {
    const working = index < slots.length && work[index];
    if (working && runStart < 0) runStart = index;
    if (!working && runStart >= 0) {
      if (index - runStart > MAX_WORK_RUN_SLOTS) {
        return {
          rule: 'max_gap_14h',
          windowStart: slots[runStart].startsAt,
          windowEnd: new Date(slots[index - 1].startsAt.getTime() + SLOT_MS),
        };
      }
      runStart = -1;
    }
  }
  return null;
}

function hasAllowedRestPeriods(work: readonly boolean[], index: number): boolean {
  let runs = 0;
  let longest = 0;
  let current = 0;
  for (let offset = 0; offset < SLOTS_PER_DAY; offset += 1) {
    const slot = index + offset;
    const resting = slot >= work.length || !work[slot];
    if (resting) {
      current += 1;
      if (current === 1) runs += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return runs <= 2 && longest >= MIN_LONG_REST_SLOTS;
}
