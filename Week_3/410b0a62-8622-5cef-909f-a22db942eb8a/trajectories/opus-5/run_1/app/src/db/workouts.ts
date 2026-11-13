import { query, type Queryable } from './pool.js';
import type { Sport, Step, Workout, WorkoutKind, WorkoutSource } from '../domain/types.js';

export interface WorkoutRow {
  id: string;
  athlete_id: string;
  kind: WorkoutKind;
  sport: Sport;
  title: string;
  date: string;
  start_local: string | null;
  start_utc: Date | null;
  duration_s: number;
  steps: Step[] | null;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if_value: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: WorkoutSource;
  version: number;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_content_type: string | null;
}

export const WORKOUT_COLUMNS = `id, athlete_id, kind, sport, title, date, start_local, start_utc,
  duration_s, steps, planned_tss, planned_if, tss, if_value, np_w, ns_mps, source, version,
  file_name, file_size, file_sha256, file_content_type`;

/** Day order: start time first, workouts without a start time last, then creation. */
const DAY_ORDER = 'order by date, start_local is null, start_local, seq';

export function toWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    kind: row.kind,
    sport: row.sport,
    title: row.title,
    date: row.date,
    start_local: row.start_local,
    start_utc: row.start_utc ? row.start_utc.toISOString() : null,
    duration_s: row.duration_s,
    steps: row.steps,
    planned_tss: row.planned_tss,
    planned_if: row.planned_if,
    tss: row.tss,
    if: row.if_value,
    np_w: row.np_w,
    ns_mps: row.ns_mps,
    source: row.source,
    version: row.version,
    file: row.file_name
      ? {
          name: row.file_name,
          size: row.file_size as number,
          sha256: row.file_sha256 as string,
          content_type: row.file_content_type as string,
        }
      : null,
  };
}

export interface NewWorkout {
  id: string;
  athleteId: string;
  kind: WorkoutKind;
  sport: Sport;
  title: string;
  date: string;
  startLocal: string | null;
  startUtc: Date | null;
  durationS: number;
  steps: Step[] | null;
  plannedTss: number | null;
  plannedIf: number | null;
  tss: number | null;
  intensityFactor: number | null;
  npW: number | null;
  nsMps: number | null;
  source: WorkoutSource;
  file: { name: string; size: number; sha256: string; contentType: string } | null;
  seedKey?: string | null;
}

export async function insertWorkout(client: Queryable, workout: NewWorkout): Promise<WorkoutRow> {
  const rows = await query<WorkoutRow>(
    client,
    `insert into workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc,
       duration_s, steps, planned_tss, planned_if, tss, if_value, np_w, ns_mps, source,
       file_name, file_size, file_sha256, file_content_type, seed_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     on conflict (seed_key) do update set
       athlete_id = excluded.athlete_id, kind = excluded.kind, sport = excluded.sport,
       title = excluded.title, date = excluded.date, start_local = excluded.start_local,
       start_utc = excluded.start_utc, duration_s = excluded.duration_s, steps = excluded.steps,
       planned_tss = excluded.planned_tss, planned_if = excluded.planned_if, tss = excluded.tss,
       if_value = excluded.if_value, np_w = excluded.np_w, ns_mps = excluded.ns_mps,
       source = excluded.source, file_name = excluded.file_name, file_size = excluded.file_size,
       file_sha256 = excluded.file_sha256, file_content_type = excluded.file_content_type
     returning ${WORKOUT_COLUMNS}`,
    [
      workout.id,
      workout.athleteId,
      workout.kind,
      workout.sport,
      workout.title,
      workout.date,
      workout.startLocal,
      workout.startUtc,
      workout.durationS,
      workout.steps ? JSON.stringify(workout.steps) : null,
      workout.plannedTss,
      workout.plannedIf,
      workout.tss,
      workout.intensityFactor,
      workout.npW,
      workout.nsMps,
      workout.source,
      workout.file?.name ?? null,
      workout.file?.size ?? null,
      workout.file?.sha256 ?? null,
      workout.file?.contentType ?? null,
      workout.seedKey ?? null,
    ],
  );
  return rows[0] as WorkoutRow;
}

export async function findWorkout(client: Queryable, id: string): Promise<WorkoutRow | null> {
  const rows = await query<WorkoutRow>(
    client,
    `select ${WORKOUT_COLUMNS} from workouts where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function workoutsBetween(
  client: Queryable,
  athleteId: string,
  from: string,
  to: string,
): Promise<WorkoutRow[]> {
  return query<WorkoutRow>(
    client,
    `select ${WORKOUT_COLUMNS} from workouts
     where athlete_id = $1 and date >= $2 and date <= $3 ${DAY_ORDER}`,
    [athleteId, from, to],
  );
}

export async function workoutsOnDay(
  client: Queryable,
  athleteId: string,
  date: string,
): Promise<WorkoutRow[]> {
  return workoutsBetween(client, athleteId, date, date);
}

export async function latestCompleted(
  client: Queryable,
  athleteId: string,
  limit: number,
): Promise<WorkoutRow[]> {
  return query<WorkoutRow>(
    client,
    `select ${WORKOUT_COLUMNS} from workouts
     where athlete_id = $1 and kind = 'completed'
     order by date desc, seq desc limit $2`,
    [athleteId, limit],
  );
}

export async function completedTssByDate(
  client: Queryable,
  athleteId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await query<{ date: string; total: number }>(
    client,
    `select date, sum(coalesce(tss, 0)) as total from workouts
     where athlete_id = $1 and kind = 'completed' and date >= $2 and date <= $3
     group by date`,
    [athleteId, from, to],
  );
  return new Map(rows.map((row) => [row.date, Number(row.total)]));
}

export async function deleteWorkoutRow(client: Queryable, id: string): Promise<void> {
  await query(client, 'delete from workouts where id = $1', [id]);
}

export async function completedOfSportInSpan(
  client: Queryable,
  athleteId: string,
  sport: Sport,
  from: string,
  to: string | null,
): Promise<WorkoutRow[]> {
  return to === null
    ? query<WorkoutRow>(
        client,
        `select ${WORKOUT_COLUMNS} from workouts
         where athlete_id = $1 and kind = 'completed' and sport = $2 and date >= $3 ${DAY_ORDER}`,
        [athleteId, sport, from],
      )
    : query<WorkoutRow>(
        client,
        `select ${WORKOUT_COLUMNS} from workouts
         where athlete_id = $1 and kind = 'completed' and sport = $2
           and date >= $3 and date <= $4 ${DAY_ORDER}`,
        [athleteId, sport, from, to],
      );
}

export async function updateScores(
  client: Queryable,
  id: string,
  scores: { tss: number; intensityFactor: number; npW: number | null; nsMps: number | null },
): Promise<void> {
  await query(
    client,
    `update workouts set tss = $2, if_value = $3, np_w = $4, ns_mps = $5, version = version + 1
     where id = $1`,
    [id, scores.tss, scores.intensityFactor, scores.npW, scores.nsMps],
  );
}

export async function updatePlanned(
  client: Queryable,
  id: string,
  fields: {
    date: string;
    startLocal: string | null;
    startUtc: Date | null;
    title: string;
    steps: Step[] | null;
    durationS: number;
    plannedTss: number | null;
    plannedIf: number | null;
  },
): Promise<WorkoutRow> {
  const rows = await query<WorkoutRow>(
    client,
    `update workouts set date = $2, start_local = $3, start_utc = $4, title = $5, steps = $6,
       duration_s = $7, planned_tss = $8, planned_if = $9, version = version + 1
     where id = $1 returning ${WORKOUT_COLUMNS}`,
    [
      id,
      fields.date,
      fields.startLocal,
      fields.startUtc,
      fields.title,
      fields.steps ? JSON.stringify(fields.steps) : null,
      fields.durationS,
      fields.plannedTss,
      fields.plannedIf,
    ],
  );
  return rows[0] as WorkoutRow;
}
