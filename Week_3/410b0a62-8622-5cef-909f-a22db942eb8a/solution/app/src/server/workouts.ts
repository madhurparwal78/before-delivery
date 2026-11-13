import type { Sport, Step, Threshold, ThresholdKind, Workout, WorkoutSource } from '../shared/types.js';
import { stepsDuration, stepsIf, stepsTss } from '../shared/steps.js';
import { scoreSession, sportOf, thresholdInForce, thresholdKindFor } from '../shared/thresholds.js';
import { newId, type User } from './access.js';
import { one, pool, type Queryable, type Tx } from './db.js';
import type { Stored } from './domain/calendar.js';
import { localToInstant, type SessionStart } from './domain/zones.js';
import { validation } from './errors.js';

interface WorkoutRow {
  id: string;
  seq: number;
  athlete_id: string;
  kind: 'planned' | 'completed';
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
  intensity: number | null;
  measure: number | null;
  source: WorkoutSource;
  version: number;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_content_type: string | null;
}

const COLUMNS = `id, seq, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s, steps, planned_tss, planned_if,
  tss, intensity, measure, source, version, file_name, file_size, file_sha256, file_content_type`;

function storedFrom(row: WorkoutRow): Stored {
  const workout: Workout = {
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
    if: row.intensity,
    np_w: row.sport === 'bike' ? row.measure : null,
    ns_mps: row.sport === 'run' ? row.measure : null,
    source: row.source,
    version: row.version,
    file:
      row.file_name !== null && row.file_size !== null && row.file_sha256 !== null && row.file_content_type !== null
        ? { name: row.file_name, size: row.file_size, sha256: row.file_sha256, content_type: row.file_content_type }
        : null
  };
  return { workout, seq: row.seq };
}

export async function loadWorkout(id: string, q: Queryable = pool): Promise<Stored | null> {
  const { rows } = await q.query<WorkoutRow>(`SELECT ${COLUMNS} FROM workouts WHERE id = $1`, [id]);
  return rows[0] ? storedFrom(rows[0]) : null;
}

export async function loadRange(athleteId: string, from: string, to: string, q: Queryable = pool): Promise<Stored[]> {
  const { rows } = await q.query<WorkoutRow>(`SELECT ${COLUMNS} FROM workouts WHERE athlete_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, seq`, [athleteId, from, to]);
  return rows.map(storedFrom);
}

export async function loadDay(athleteId: string, date: string, q: Queryable = pool): Promise<Stored[]> {
  return loadRange(athleteId, date, date, q);
}

export async function loadThresholds(athleteId: string, q: Queryable = pool): Promise<Threshold[]> {
  const { rows } = await q.query<Threshold>('SELECT kind, value, effective_from FROM thresholds WHERE athlete_id = $1 ORDER BY effective_from, kind', [athleteId]);
  return rows;
}

const startUtcOf = (tz: string, date: string, startLocal: string | null): Date | null =>
  startLocal === null ? null : localToInstant(date, startLocal, tz);

interface PlannedInput {
  id?: string;
  athlete: User;
  date: string;
  startLocal: string | null;
  sport: Sport;
  title: string;
  /** Either steps, or a plain duration in seconds. */
  shape: { steps: Step[] } | { duration_s: number };
  source: WorkoutSource;
}

export async function insertPlanned(tx: Tx, input: PlannedInput): Promise<Stored> {
  const steps = 'steps' in input.shape ? input.shape.steps : null;
  const duration = steps ? stepsDuration(steps) : (input.shape as { duration_s: number }).duration_s;
  const { rows } = await tx.query<WorkoutRow>(
    `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s, steps, planned_tss, planned_if, source)
     VALUES ($1, $2, 'planned', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET sport = EXCLUDED.sport, title = EXCLUDED.title, date = EXCLUDED.date, start_local = EXCLUDED.start_local,
       start_utc = EXCLUDED.start_utc, duration_s = EXCLUDED.duration_s, steps = EXCLUDED.steps, planned_tss = EXCLUDED.planned_tss,
       planned_if = EXCLUDED.planned_if, source = EXCLUDED.source, version = workouts.version + 1
     RETURNING ${COLUMNS}`,
    [
      input.id ?? newId(),
      input.athlete.id,
      input.sport,
      input.title,
      input.date,
      input.startLocal,
      startUtcOf(input.athlete.tz, input.date, input.startLocal),
      duration,
      steps ? JSON.stringify(steps) : null,
      steps ? stepsTss(steps) : null,
      steps ? stepsIf(steps) : null,
      input.source
    ]
  );
  return storedFrom(one({ rows }));
}

/** The threshold in force for a sport on a day, or the published refusal when there is none. */
export async function thresholdFor(athlete: User, sport: Sport, date: string, q: Queryable): Promise<Threshold> {
  const threshold = thresholdInForce(await loadThresholds(athlete.id, q), thresholdKindFor(sport), date);
  if (threshold) return threshold;
  throw validation({ threshold: sport === 'bike' ? 'No FTP is set on or before this day.' : 'No threshold pace is set on or before this day.' });
}

export interface CompletedInput {
  id?: string;
  athlete: User;
  date: string;
  sport: Sport;
  title: string;
  durationS: number;
  /** Watts for a bike, metres per second for a run: the normalised value of a file or the average of a hand entry. */
  measure: number;
  start: SessionStart | null;
  file: { name: string; size: number; sha256: string; contentType: string } | null;
}

/** Inserts a completed workout scored with the threshold in force, read under the caller's athlete lock. */
export async function insertCompleted(tx: Tx, input: CompletedInput): Promise<Stored> {
  const threshold = await thresholdFor(input.athlete, input.sport, input.date, tx);
  const score = scoreSession(input.sport, input.durationS, input.measure, threshold);
  const { rows } = await tx.query<WorkoutRow>(
    `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s, tss, intensity, measure,
       source, file_name, file_size, file_sha256, file_content_type)
     VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET sport = EXCLUDED.sport, title = EXCLUDED.title, date = EXCLUDED.date, start_local = EXCLUDED.start_local,
       start_utc = EXCLUDED.start_utc, duration_s = EXCLUDED.duration_s, tss = EXCLUDED.tss, intensity = EXCLUDED.intensity,
       measure = EXCLUDED.measure, source = EXCLUDED.source, file_name = EXCLUDED.file_name, file_size = EXCLUDED.file_size,
       file_sha256 = EXCLUDED.file_sha256, file_content_type = EXCLUDED.file_content_type, version = workouts.version + 1
     RETURNING ${COLUMNS}`,
    [
      input.id ?? newId(),
      input.athlete.id,
      input.sport,
      input.title,
      input.date,
      input.start?.start_local ?? null,
      input.start?.start_utc ?? null,
      input.durationS,
      score.tss,
      score.if,
      input.measure,
      input.file ? 'file' : 'manual',
      input.file?.name ?? null,
      input.file?.size ?? null,
      input.file?.sha256 ?? null,
      input.file?.contentType ?? null
    ]
  );
  return storedFrom(one({ rows }));
}

export async function updatePlanned(tx: Tx, athlete: User, id: string, change: { date?: string; startLocal?: string | null; title?: string; steps?: Step[] }, current: Workout): Promise<Stored> {
  const date = change.date ?? current.date;
  const startLocal = change.startLocal === undefined ? current.start_local : change.startLocal;
  const steps = change.steps ?? current.steps;
  const { rows } = await tx.query<WorkoutRow>(
    `UPDATE workouts SET date = $2, start_local = $3, start_utc = $4, title = $5, steps = $6, duration_s = $7, planned_tss = $8,
       planned_if = $9, version = version + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      id,
      date,
      startLocal,
      startUtcOf(athlete.tz, date, startLocal),
      change.title ?? current.title,
      steps ? JSON.stringify(steps) : null,
      steps ? stepsDuration(steps) : current.duration_s,
      steps ? stepsTss(steps) : null,
      steps ? stepsIf(steps) : null
    ]
  );
  return storedFrom(one({ rows }));
}

export async function updateCompletedTitle(tx: Tx, id: string, title: string): Promise<Stored> {
  const { rows } = await tx.query<WorkoutRow>(`UPDATE workouts SET title = $2, version = version + 1 WHERE id = $1 RETURNING ${COLUMNS}`, [id, title]);
  return storedFrom(one({ rows }));
}

export async function removeWorkout(tx: Tx, id: string): Promise<void> {
  await tx.query('DELETE FROM workouts WHERE id = $1', [id]);
}

/**
 * Re-scores exactly the completed workouts of the threshold's sport dated from its effective day up to
 * the day before the next later entry of the same kind. Returns the number re-scored.
 */
export async function rescoreFrom(tx: Tx, athleteId: string, kind: ThresholdKind, from: string): Promise<number> {
  const history = await loadThresholds(athleteId, tx);
  const sport = sportOf(kind);
  const next = history.filter((entry) => entry.kind === kind && entry.effective_from > from).map((entry) => entry.effective_from)[0] ?? null;
  const { rows } = await tx.query<{ id: string; date: string; sport: Sport; duration_s: number; measure: number }>(
    `SELECT id, date, sport, duration_s, measure FROM workouts
      WHERE athlete_id = $1 AND kind = 'completed' AND sport = $2 AND date >= $3 AND ($4::date IS NULL OR date < $4)`,
    [athleteId, sport, from, next]
  );
  for (const row of rows) {
    const threshold = thresholdInForce(history, thresholdKindFor(row.sport), row.date) as Threshold;
    const score = scoreSession(row.sport, row.duration_s, row.measure, threshold);
    await tx.query('UPDATE workouts SET tss = $2, intensity = $3, version = version + 1 WHERE id = $1', [row.id, score.tss, score.if]);
  }
  return rows.length;
}
