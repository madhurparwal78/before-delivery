import type { Queryable } from '../db/pool.js';
import { insertWorkout, type WorkoutRow } from '../db/workouts.js';
import type { UserRow } from '../db/users.js';
import type { Sport } from '../domain/types.js';
import { recomputeSeriesFrom, scoreWithThreshold } from './scoring.js';

export interface CompletedInput {
  id: string;
  athlete: UserRow;
  sport: Sport;
  title: string;
  date: string;
  startLocal: string | null;
  startUtc: Date | null;
  durationS: number;
  normalised: number;
  threshold: number;
  source: 'manual' | 'file';
  file: { name: string; size: number; sha256: string; contentType: string } | null;
  seedKey?: string | null;
}

/** Scores a completed session and stores it with its series in one transaction. */
export async function insertCompleted(
  client: Queryable,
  input: CompletedInput,
  today: string,
): Promise<WorkoutRow> {
  const scores = scoreWithThreshold(
    input.sport,
    input.durationS,
    input.normalised,
    input.threshold,
  );
  const row = await insertWorkout(client, {
    id: input.id,
    athleteId: input.athlete.id,
    kind: 'completed',
    sport: input.sport,
    title: input.title,
    date: input.date,
    startLocal: input.startLocal,
    startUtc: input.startUtc,
    durationS: input.durationS,
    steps: null,
    plannedTss: null,
    plannedIf: null,
    tss: scores.tss,
    intensityFactor: scores.intensityFactor,
    npW: scores.npW,
    nsMps: scores.nsMps,
    source: input.source,
    file: input.file,
    seedKey: input.seedKey ?? null,
  });
  await recomputeSeriesFrom(client, input.athlete, input.date, today);
  return row;
}
