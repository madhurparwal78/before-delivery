import type { Repeats, Routine } from "../shared/types.js";
import { addDays, daysBetween, isoInstant, localToInstant, wallOf, weekdayOf } from "../shared/time.js";
import type { Db } from "./db.js";

export type RoutineRow = { id: string; name: string; start_time: string; duration_minutes: number; repeats: Repeats };

type Occurrence = { id: string; routineId: string; name: string; date: string; start: number; end: number };

export function routineJson(row: RoutineRow): Routine {
  return { id: row.id, name: row.name, startTime: row.start_time, durationMinutes: row.duration_minutes, repeats: row.repeats };
}

export function routinesOf(db: Db, memberId: string): Promise<RoutineRow[]> {
  return db<RoutineRow[]>`
    SELECT id, name, start_time, duration_minutes, repeats FROM routines
    WHERE member_id = ${memberId} ORDER BY start_time, created_at`;
}

/**
 * Routine expansion across daylight-saving changes: exactly one occurrence per qualifying local date,
 * at the wall-clock start resolved by localToInstant (gap → later by the gap, overlap → earlier instant).
 */
export function expandRoutines(routines: RoutineRow[], from: string, to: string, zone: string): Occurrence[] {
  const out: Occurrence[] = [];
  const span = daysBetween(from, to);
  for (let offset = 0; offset <= span; offset++) {
    const date = addDays(from, offset);
    const weekday = weekdayOf(date) < 5;
    for (const routine of routines) {
      if (routine.repeats === "weekdays" && !weekday) continue;
      const start = localToInstant(date, routine.start_time, zone);
      out.push({
        id: `${routine.id}:${date}`,
        routineId: routine.id,
        name: routine.name,
        date,
        start,
        end: start + routine.duration_minutes * 60_000,
      });
    }
  }
  return out;
}

export function occurrenceItem(o: Occurrence, zone: string) {
  return {
    kind: "routine" as const,
    id: o.id,
    title: o.name,
    date: o.date,
    startTime: wallOf(o.start, zone).time,
    endTime: wallOf(o.end, zone).time,
    start: isoInstant(o.start),
    end: isoInstant(o.end),
  };
}
