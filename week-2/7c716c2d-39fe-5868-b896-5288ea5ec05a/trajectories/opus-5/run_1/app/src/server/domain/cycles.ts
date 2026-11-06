import type { CycleDay } from '../../shared/types.js';
import {
  anchorOf,
  calendarOn,
  countedDay,
  historyKey,
  midnightOn,
  type CalendarHistory,
} from './calendar.js';
import { addDays, localMidnight, offsetAt } from './zone.js';

export const WORKING_DAYS_PER_CYCLE = 10;
export const MAX_CYCLE_NUMBER = 1000;

export type CycleSpan = {
  number: number;
  firstWorkingDate: string;
  lastWorkingDate: string;
  nextFirstWorkingDate: string;
  startsAt: number;
  endsAt: number;
  days: CycleDay[];
};

type Walk = { key: string; anchor: string; counted: string[]; cursor: string };

const walks = new Map<string, Walk>();

function walkOf(history: CalendarHistory): Walk {
  const key = historyKey(history);
  const anchor = anchorOf(history);
  const found = walks.get(history.workspaceId);
  if (found !== undefined && found.key === key && found.anchor === anchor) return found;
  const fresh: Walk = { key, anchor, counted: [], cursor: anchor };
  walks.set(history.workspaceId, fresh);
  return fresh;
}

/** The counted days from the anchor onwards, extended on demand and cached per calendar. */
function countedDates(history: CalendarHistory, howMany: number): string[] {
  const walk = walkOf(history);
  let guard = 0;
  while (walk.counted.length < howMany) {
    if (countedDay(history, walk.cursor).counted) walk.counted.push(walk.cursor);
    walk.cursor = addDays(walk.cursor, 1);
    guard += 1;
    if (guard > 400000) throw new Error('No counted days in this calendar');
  }
  return walk.counted;
}

function clockChange(history: CalendarHistory, date: string): 'forward' | 'back' | null {
  const zone = calendarOn(history, date).timeZone;
  const start = localMidnight(zone, date);
  const end = localMidnight(zone, addDays(date, 1)) - 1;
  const before = offsetAt(zone, start - 1);
  const after = offsetAt(zone, end);
  if (after > before) return 'forward';
  if (after < before) return 'back';
  return null;
}

export function cycleSpan(history: CalendarHistory, number: number): CycleSpan {
  const needed = number * WORKING_DAYS_PER_CYCLE + 1;
  const counted = countedDates(history, needed);
  const firstWorkingDate = counted[(number - 1) * WORKING_DAYS_PER_CYCLE];
  const lastWorkingDate = counted[number * WORKING_DAYS_PER_CYCLE - 1];
  const nextFirstWorkingDate = counted[number * WORKING_DAYS_PER_CYCLE];
  if (firstWorkingDate === undefined || lastWorkingDate === undefined || nextFirstWorkingDate === undefined) {
    throw new Error(`Cycle ${number} is not reachable`);
  }
  const days: CycleDay[] = [];
  for (let date = firstWorkingDate; date < nextFirstWorkingDate; date = addDays(date, 1)) {
    const count = countedDay(history, date);
    days.push({
      date,
      counted: count.counted,
      reason: count.reason,
      clock_change: clockChange(history, date),
    });
  }
  return {
    number,
    firstWorkingDate,
    lastWorkingDate,
    nextFirstWorkingDate,
    startsAt: midnightOn(history, firstWorkingDate),
    endsAt: midnightOn(history, nextFirstWorkingDate),
    days,
  };
}

/** The cycle whose span holds an instant, or cycle 1 when the instant is before the anchor. */
export function cycleNumberAt(history: CalendarHistory, instant: number): number {
  let number = 1;
  for (;;) {
    const span = cycleSpan(history, number);
    if (instant < span.startsAt) return 1;
    if (instant < span.endsAt) return number;
    number += 1;
    if (number > MAX_CYCLE_NUMBER) return MAX_CYCLE_NUMBER;
  }
}
