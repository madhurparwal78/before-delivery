/**
 * Intake appointment slots: 20 minutes long, Tuesday to Saturday, every 20 minutes from
 * 10:00 to 17:40 Brussels time, bookable from tomorrow up to 32 weeks ahead. Slots keep
 * their wall-clock times across clock changes.
 */

import {
  addDays,
  brusselsDate,
  brusselsInstant,
  isValidBrusselsDate,
  mondayOf,
  startOfBrusselsDay,
  weekdayOf,
  type BrusselsDate,
} from '../../shared/brussels.js';

export const SLOT_MINUTES = 20;
const FIRST_SLOT_MINUTE = 10 * 60;
const LAST_SLOT_MINUTE = 17 * 60 + 40;
const BOOKABLE_DAYS = 224;
const OPEN_WEEKDAYS = [2, 3, 4, 5, 6];

export interface SlotRange {
  firstDate: BrusselsDate;
  /** The first date that is no longer bookable. */
  endDate: BrusselsDate;
  firstWeek: BrusselsDate;
  lastWeek: BrusselsDate;
}

export function slotRange(now: number): SlotRange {
  const firstDate = addDays(brusselsDate(now), 1);
  const endDate = addDays(firstDate, BOOKABLE_DAYS);
  return {
    firstDate,
    endDate,
    firstWeek: mondayOf(firstDate),
    lastWeek: mondayOf(addDays(endDate, -1)),
  };
}

function slotMinutes(): number[] {
  const minutes: number[] = [];
  for (let minute = FIRST_SLOT_MINUTE; minute <= LAST_SLOT_MINUTE; minute += SLOT_MINUTES) {
    minutes.push(minute);
  }
  return minutes;
}

/** Every slot start on a Brussels date, whether or not it is bookable. */
export function slotsOnDate(date: BrusselsDate): number[] {
  if (!OPEN_WEEKDAYS.includes(weekdayOf(date))) return [];
  return slotMinutes().map((minute) =>
    brusselsInstant(date, Math.floor(minute / 60), minute % 60),
  );
}

export function slotEndsAt(startsAt: number): number {
  return startsAt + SLOT_MINUTES * 60_000;
}

/** Whether an instant is the start of a bookable slot. */
export function isBookableSlot(startsAt: number, now: number): boolean {
  const range = slotRange(now);
  if (startsAt < startOfBrusselsDay(range.firstDate)) return false;
  if (startsAt >= startOfBrusselsDay(range.endDate)) return false;
  return slotsOnDate(brusselsDate(startsAt)).includes(startsAt);
}

/** Every bookable slot start from `after` (exclusive) onwards, in ascending order. */
export function* bookableSlotsAfter(after: number, now: number): Generator<number> {
  const range = slotRange(now);
  const limit = startOfBrusselsDay(range.endDate);
  let date = brusselsDate(Math.max(after, startOfBrusselsDay(range.firstDate)));
  while (startOfBrusselsDay(date) < limit) {
    for (const startsAt of slotsOnDate(date)) {
      if (startsAt > after && startsAt < limit) yield startsAt;
    }
    date = addDays(date, 1);
  }
}

/** The Monday a `week` parameter asks for, or null when it is not a bookable Monday. */
export function resolveWeek(week: string | null, now: number): BrusselsDate | null {
  const range = slotRange(now);
  if (week === null) return range.firstWeek;
  if (!isValidBrusselsDate(week) || weekdayOf(week) !== 1) return null;
  if (week < range.firstWeek || week > range.lastWeek) return null;
  return week;
}

export function weekDays(week: BrusselsDate): BrusselsDate[] {
  return OPEN_WEEKDAYS.map((weekday) => addDays(week, weekday - 1));
}
