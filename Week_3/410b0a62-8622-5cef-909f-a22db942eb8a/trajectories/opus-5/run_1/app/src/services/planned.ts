import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import { insertWorkout, type WorkoutRow } from '../db/workouts.js';
import type { UserRow } from '../db/users.js';
import { plannedIf, plannedTss, stepsDurationS } from '../domain/steps.js';
import { localToInstant } from '../domain/time.js';
import type { Sport, Step, WorkoutSource } from '../domain/types.js';

export interface PlannedInput {
  athlete: UserRow;
  date: string;
  startLocal: string | null;
  sport: Sport;
  title: string;
  steps: Step[] | null;
  durationS: number | null;
  source: WorkoutSource;
  id?: string;
  seedKey?: string | null;
}

/** Wall-clock start times are stored local, with the instant derived per zone. */
export function startUtcFor(
  date: string,
  startLocal: string | null,
  tz: string,
): Date | null {
  return startLocal === null ? null : localToInstant(date, startLocal, tz);
}

export async function createPlanned(
  client: Queryable,
  input: PlannedInput,
): Promise<WorkoutRow> {
  const steps = input.steps;
  return insertWorkout(client, {
    id: input.id ?? randomUUID(),
    athleteId: input.athlete.id,
    kind: 'planned',
    sport: input.sport,
    title: input.title,
    date: input.date,
    startLocal: input.startLocal,
    startUtc: startUtcFor(input.date, input.startLocal, input.athlete.tz),
    durationS: steps ? stepsDurationS(steps) : (input.durationS as number),
    steps,
    plannedTss: steps ? plannedTss(steps) : null,
    plannedIf: steps ? plannedIf(steps) : null,
    tss: null,
    intensityFactor: null,
    npW: null,
    nsMps: null,
    source: input.source,
    file: null,
    seedKey: input.seedKey ?? null,
  });
}
