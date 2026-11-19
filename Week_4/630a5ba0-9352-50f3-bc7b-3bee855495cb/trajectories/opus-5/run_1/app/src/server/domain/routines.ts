import type { RoutineRepeats } from '../../shared/types.js';
import {
  addDays,
  compareDates,
  dayOfWeek,
  instantAtLocalTime,
  localTimeOf,
  minutesOfDay,
} from '../../shared/time.js';

export interface RoutineRecord {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  repeats: RoutineRepeats;
}

export interface RoutineOccurrence {
  id: string;
  routineId: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  start: Date;
  end: Date;
  durationMinutes: number;
}

function appliesOn(repeats: RoutineRepeats, date: string): boolean {
  if (repeats === 'daily') return true;
  const weekday = dayOfWeek(date);
  return weekday >= 1 && weekday <= 5;
}

/**
 * Exactly one occurrence per qualifying local date, always at the routine's wall-clock
 * start. A start inside a daylight-saving gap lands the length of the gap later, and a
 * start that happens twice uses the first instant; both come from instantAtLocalTime.
 */
export function occurrenceOn(
  routine: RoutineRecord,
  date: string,
  timeZone: string,
): RoutineOccurrence | null {
  if (!appliesOn(routine.repeats, date)) return null;
  const start = instantAtLocalTime(date, routine.startTime, timeZone);
  const end = new Date(start.getTime() + routine.durationMinutes * 60_000);
  return {
    id: `${routine.id}:${date}`,
    routineId: routine.id,
    name: routine.name,
    date,
    startTime: localTimeOf(start, timeZone),
    endTime: localTimeOf(end, timeZone),
    start,
    end,
    durationMinutes: routine.durationMinutes,
  };
}

export function expandRoutines(
  routines: RoutineRecord[],
  timeZone: string,
  fromDate: string,
  toDate: string,
): RoutineOccurrence[] {
  const occurrences: RoutineOccurrence[] = [];
  for (let date = fromDate; compareDates(date, toDate) <= 0; date = addDays(date, 1)) {
    for (const routine of routines) {
      const occurrence = occurrenceOn(routine, date, timeZone);
      if (occurrence) occurrences.push(occurrence);
    }
  }
  occurrences.sort(
    (left, right) =>
      compareDates(left.date, right.date) ||
      minutesOfDay(left.startTime) - minutesOfDay(right.startTime) ||
      left.routineId.localeCompare(right.routineId),
  );
  return occurrences;
}
