import { addDays, isoInstant, routineStartInstant } from './domain.js';

export interface Routine {
  readonly id: string;
  readonly name: string;
  readonly startTime: string; // HH:MM local
  readonly durationMinutes: number;
  readonly repeats: 'daily' | 'weekdays';
}

export interface Occurrence {
  /** "<routineId>:<date>" */
  readonly id: string;
  readonly routineId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly start: string; // ISO instant
  readonly end: string;
}

/**
 * The single rule for expanding a routine onto local dates, DST-safe.
 * Gap: start later by the gap's length. Overlap: the first (earlier) instant.
 */
export function expandRoutine(routine: Routine, fromDate: string, toDate: string, timeZone: string): Occurrence[] {
  const out: Occurrence[] = [];
  const durationMs = routine.durationMinutes * 60_000;
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    if (!routineAppliesOn(routine, date)) continue;
    const startInstant = routineStartInstant(date, routine.startTime, timeZone);
    if (startInstant === null) continue;
    const endInstant = new Date(startInstant.getTime() + durationMs);
    out.push({
      id: `${routine.id}:${date}`,
      routineId: routine.id,
      date,
      startTime: routine.startTime,
      endTime: occurrenceEndTime(startInstant, routine.durationMinutes, timeZone),
      start: isoInstant(startInstant),
      end: isoInstant(endInstant),
    });
  }
  return out;
}

export function routineAppliesOn(routine: Routine, date: string): boolean {
  const dow = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
  if (routine.repeats === 'daily') return true;
  return dow >= 1 && dow <= 5;
}

/** End-of-occurrence wall clock, derived from the start instant plus duration. */
export function occurrenceEndTime(startInstant: Date, durationMinutes: number, timeZone: string): string {
  const end = new Date(startInstant.getTime() + durationMinutes * 60_000);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  return fmt.format(end);
}

