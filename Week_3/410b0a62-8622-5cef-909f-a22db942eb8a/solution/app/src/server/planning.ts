import { addDays, mondayOfWeek, weekdayIndex } from '../shared/dates.js';
import { snapDuration, stepsDuration, stepsIf, stepsTss } from '../shared/steps.js';
import type { ApplyResult, CopyResult, LibraryItem, Plan, PlanEntry, Sport, Step, Threshold, ThresholdKind, ThresholdResult, Workout } from '../shared/types.js';
import { audienceOf, newId, type User } from './access.js';
import { one, pool, transaction, type Queryable } from './db.js';
import { itemsOfDay } from './domain/calendar.js';
import { conflict, FieldErrors, notFound, StorageFailure, storageUnavailable, validation } from './errors.js';
import { publishChange } from './live.js';
import { lockAthlete, recomputeSeries } from './series.js';
import { deleteObject } from './storage.js';
import { originalKey } from './sessions.js';
import { insertPlanned, loadDay, loadRange, loadWorkout, removeWorkout, rescoreFrom, updateCompletedTitle, updatePlanned } from './workouts.js';
import {
  cleanSteps, dateMessage, durationMessage, eventNameMessage, plannedDateMessage, sportMessage, startLocalMessage, stepsMessage, thresholdValueMessage,
  titleMessage, weekMessage, weeksMessage, MESSAGES
} from './validation.js';

const REST_WEEK_EVERY = 4;
const REST_SHARE = 0.6;
const DAYS_PER_WEEK = 7;

interface ShapeRequest {
  steps?: unknown;
  duration_s?: unknown;
  library_id?: unknown;
}

// ---------------------------------------------------------------- library

interface LibraryRow {
  id: string;
  name: string;
  sport: Sport;
  steps: Step[];
}

const libraryItem = (row: LibraryRow): LibraryItem => ({
  id: row.id,
  name: row.name,
  sport: row.sport,
  steps: row.steps,
  duration_s: stepsDuration(row.steps),
  planned_tss: stepsTss(row.steps),
  planned_if: stepsIf(row.steps)
});

export async function listLibrary(ownerId: string): Promise<LibraryItem[]> {
  const { rows } = await pool.query<LibraryRow>('SELECT id, name, sport, steps FROM library_items WHERE owner_id = $1 ORDER BY created_at, id', [ownerId]);
  return rows.map(libraryItem);
}

export async function addLibraryItem(owner: User, body: { name?: unknown; sport?: unknown; steps?: unknown }, id = newId(), q: Queryable = pool): Promise<LibraryItem> {
  const errors = new FieldErrors();
  errors.add('name', titleMessage(body.name));
  errors.add('sport', sportMessage(body.sport));
  errors.add('steps', stepsMessage(body.steps));
  errors.throwIfAny();
  const { rows } = await q.query<LibraryRow>(
    `INSERT INTO library_items (id, owner_id, name, sport, steps) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sport = EXCLUDED.sport, steps = EXCLUDED.steps
     RETURNING id, name, sport, steps`,
    [id, owner.id, (body.name as string).trim(), body.sport, JSON.stringify(cleanSteps(body.steps as unknown[]))]
  );
  return libraryItem(one({ rows }));
}

export async function removeLibraryItem(ownerId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM library_items WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return rowCount === 1;
}

// ---------------------------------------------------------------- planned workouts

interface WorkoutRequest extends ShapeRequest {
  date?: unknown;
  start_local?: unknown;
  sport?: unknown;
  title?: unknown;
}

/** Plans a workout on a day from steps, a plain duration or a library workout. */
export async function createPlanned(actor: User, athlete: User, today: string, body: WorkoutRequest): Promise<Workout> {
  const errors = new FieldErrors();
  errors.add('date', dateMessage(body.date) ?? plannedDateMessage(body.date as string, today));
  if (body.start_local !== undefined && body.start_local !== null) errors.add('start_local', startLocalMessage(body.start_local));
  errors.add('sport', sportMessage(body.sport));
  errors.add('title', titleMessage(body.title));
  const given = [body.steps, body.duration_s, body.library_id].filter((value) => value !== undefined);
  if (given.length !== 1) errors.add('steps', MESSAGES.noSteps);
  else if (body.steps !== undefined) errors.add('steps', stepsMessage(body.steps));
  else if (body.duration_s !== undefined) errors.add('duration_s', durationMessage(body.duration_s));
  errors.throwIfAny();

  let library: LibraryRow | null = null;
  if (body.library_id !== undefined) {
    const { rows } = await pool.query<LibraryRow>('SELECT id, name, sport, steps FROM library_items WHERE id = $1 AND owner_id = $2', [String(body.library_id), actor.id]);
    library = rows[0] ?? null;
    if (!library) throw notFound();
  }
  const steps = library ? library.steps : body.steps !== undefined ? cleanSteps(body.steps as unknown[]) : null;
  const stored = await transaction(async (tx) =>
    insertPlanned(tx, {
      athlete,
      date: body.date as string,
      startLocal: (body.start_local as string | null | undefined) ?? null,
      sport: body.sport as Sport,
      title: (body.title as string).trim(),
      shape: steps ? { steps } : { duration_s: body.duration_s as number },
      source: library ? 'library' : 'builder'
    })
  );
  publishChange(await audienceOf(athlete.id), athlete.id, ['workouts']);
  return stored.workout;
}

interface PatchRequest {
  version?: unknown;
  date?: unknown;
  start_local?: unknown;
  title?: unknown;
  steps?: unknown;
}

/** Edits or moves a workout. Validation answers before a state conflict. */
export async function patchWorkout(athlete: User, today: string, id: string, body: PatchRequest): Promise<Workout> {
  const errors = new FieldErrors();
  if (body.date !== undefined) errors.add('date', dateMessage(body.date) ?? plannedDateMessage(body.date as string, today));
  if (body.start_local !== undefined && body.start_local !== null) errors.add('start_local', startLocalMessage(body.start_local));
  if (body.title !== undefined) errors.add('title', titleMessage(body.title));
  if (body.steps !== undefined) errors.add('steps', stepsMessage(body.steps));
  errors.throwIfAny();

  const result = await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    const current = await loadWorkout(id, tx);
    if (!current) throw notFound();
    const workout = current.workout;
    if (body.version !== workout.version) throw conflict('stale');
    if (body.date !== undefined && body.date !== workout.date) {
      const paired = workout.kind === 'planned' && itemsOfDay(await loadDay(athlete.id, workout.date, tx), workout.date, today).some((item) => item.planned?.id === id && item.completed !== null);
      if (workout.kind === 'completed' || paired) throw conflict('locked');
    }
    if (workout.kind === 'completed') {
      return body.title === undefined ? current : updateCompletedTitle(tx, id, (body.title as string).trim());
    }
    return updatePlanned(
      tx,
      athlete,
      id,
      {
        ...(body.date !== undefined && { date: body.date as string }),
        ...(body.start_local !== undefined && { startLocal: body.start_local as string | null }),
        ...(body.title !== undefined && { title: (body.title as string).trim() }),
        ...(body.steps !== undefined && { steps: cleanSteps(body.steps as unknown[]) })
      },
      workout
    );
  });
  publishChange(await audienceOf(athlete.id), athlete.id, ['workouts'], id);
  return result.workout;
}

/** Removes a workout with its stored file and its stress in one step, or not at all. */
export async function deleteWorkout(athlete: User, today: string, id: string): Promise<void> {
  await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    // Re-read under the athlete lock: of simultaneous deletes only the first still finds the workout.
    const current = await loadWorkout(id, tx);
    if (!current) throw notFound();
    const { workout } = current;
    if (workout.file) {
      try {
        await deleteObject(originalKey(workout.athlete_id, workout.id, workout.file.content_type));
      } catch (error) {
        if (error instanceof StorageFailure) throw storageUnavailable('original');
        throw error;
      }
    }
    await removeWorkout(tx, id);
    if (workout.kind === 'completed') await recomputeSeries(tx, athlete, workout.date, today);
  });
  publishChange(await audienceOf(athlete.id), athlete.id, ['workouts', 'series'], id);
}

// ---------------------------------------------------------------- thresholds

export async function saveThreshold(athlete: User, today: string, body: { kind?: unknown; value?: unknown; effective_from?: unknown }): Promise<{ status: 200 | 201; result: ThresholdResult }> {
  const errors = new FieldErrors();
  const kind: ThresholdKind | null = body.kind === 'ftp' || body.kind === 'pace' ? body.kind : null;
  errors.add('kind', kind === null ? 'Choose ftp or pace.' : null);
  if (kind !== null) errors.add('value', thresholdValueMessage(kind, body.value));
  errors.add('effective_from', dateMessage(body.effective_from));
  errors.throwIfAny();
  const from = body.effective_from as string;
  const threshold: Threshold = { kind: kind as ThresholdKind, value: body.value as number, effective_from: from };

  const outcome = await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    const upsert = await tx.query<{ created: boolean }>(
      `INSERT INTO thresholds (athlete_id, kind, effective_from, value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (athlete_id, kind, effective_from) DO UPDATE SET value = EXCLUDED.value
       RETURNING (xmax = 0) AS created`,
      [athlete.id, threshold.kind, from, threshold.value]
    );
    const rescored = await rescoreFrom(tx, athlete.id, threshold.kind, from);
    const seriesFrom = athlete.series_start !== null && from < athlete.series_start ? athlete.series_start : from;
    await recomputeSeries(tx, athlete, seriesFrom, today);
    return { status: one(upsert).created ? (201 as const) : (200 as const), result: { threshold, rescored, series_from: seriesFrom } };
  });
  publishChange(await audienceOf(athlete.id), athlete.id, ['thresholds', 'workouts', 'series']);
  return outcome;
}

// ---------------------------------------------------------------- plans

interface PlanRow {
  id: string;
  name: string;
  weeks: number;
  entries: { day: number; start_local: string; sport: Sport; title: string; steps: Step[] | null; duration_s: number }[];
}

const planOf = (row: PlanRow): Plan => ({
  id: row.id,
  name: row.name,
  weeks: row.weeks,
  entries: row.entries.map((entry): PlanEntry => ({ ...entry, duration_s: entry.steps ? stepsDuration(entry.steps) : entry.duration_s }))
});

export async function listPlans(ownerId: string): Promise<Plan[]> {
  const { rows } = await pool.query<PlanRow>('SELECT id, name, weeks, entries FROM plans WHERE owner_id = $1 ORDER BY created_at, id', [ownerId]);
  return rows.map(planOf);
}

export async function addPlan(owner: User, body: { name?: unknown; weeks?: unknown; entries?: unknown }, id = newId(), q: Queryable = pool): Promise<Plan> {
  const errors = new FieldErrors();
  errors.add('name', titleMessage(body.name));
  errors.add('weeks', weeksMessage(body.weeks));
  const entries = Array.isArray(body.entries) ? body.entries.map((entry: unknown): Record<string, unknown> => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {})) : [];
  entries.forEach((entry, index) => {
    const day = entry['day'];
    const inRange = typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= DAYS_PER_WEEK * (typeof body.weeks === 'number' ? body.weeks : 0);
    errors.add(`entries[${index}].day`, inRange ? null : 'Each plan day must fall inside the plan.');
    errors.add(`entries[${index}].start_local`, startLocalMessage(entry['start_local']));
    errors.add(`entries[${index}].sport`, sportMessage(entry['sport']));
    errors.add(`entries[${index}].title`, titleMessage(entry['title']));
    errors.add(`entries[${index}].steps`, entry['steps'] ? stepsMessage(entry['steps']) : durationMessage(entry['duration_s']));
  });
  errors.throwIfAny();
  const clean = entries.map((entry) => ({
    day: entry['day'],
    start_local: entry['start_local'],
    sport: entry['sport'],
    title: (entry['title'] as string).trim(),
    steps: entry['steps'] ? cleanSteps(entry['steps'] as unknown[]) : null,
    duration_s: entry['steps'] ? stepsDuration(cleanSteps(entry['steps'] as unknown[])) : entry['duration_s']
  }));
  const { rows } = await q.query<PlanRow>(
    `INSERT INTO plans (id, owner_id, name, weeks, entries) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, weeks = EXCLUDED.weeks, entries = EXCLUDED.entries
     RETURNING id, name, weeks, entries`,
    [id, owner.id, (body.name as string).trim(), body.weeks, JSON.stringify(clean)]
  );
  return planOf(one({ rows }));
}

export async function planOwnedBy(ownerId: string, id: string): Promise<Plan | null> {
  const { rows } = await pool.query<PlanRow>('SELECT id, name, weeks, entries FROM plans WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return rows[0] ? planOf(rows[0]) : null;
}

const restSeconds = (seconds: number): number => snapDuration(seconds * REST_SHARE);

/** A rest week keeps targets and repeats and takes 60% of every duration, snapped to 30 seconds. */
function scaleForRest(entry: PlanEntry): { steps: Step[] } | { duration_s: number } {
  if (!entry.steps) return { duration_s: restSeconds(entry.duration_s) };
  return {
    steps: entry.steps.map((step): Step =>
      step.kind === 'interval'
        ? { ...step, work: { ...step.work, duration_s: restSeconds(step.work.duration_s) }, recovery: { ...step.recovery, duration_s: restSeconds(step.recovery.duration_s) } }
        : { ...step, duration_s: restSeconds(step.duration_s) }
    )
  };
}

interface ApplyRequest {
  athlete_id?: unknown;
  mode?: unknown;
  date?: unknown;
  event_name?: unknown;
}

/** Applies a plan template from a start date, or counted back from an event date. */
export async function applyPlan(plan: Plan, athlete: User, today: string, body: ApplyRequest): Promise<ApplyResult> {
  const errors = new FieldErrors();
  const mode = body.mode === 'start' || body.mode === 'event' ? body.mode : null;
  errors.add('mode', mode === null ? MESSAGES.mode : null);
  errors.add('date', dateMessage(body.date));
  if (mode === 'event') errors.add('event_name', eventNameMessage(body.event_name));
  errors.throwIfAny();

  const date = body.date as string;
  const span = DAYS_PER_WEEK * plan.weeks;
  const firstDay = mode === 'start' ? date : addDays(date, -(span - 1));
  const lastDay = addDays(firstDay, span - 1);

  const result = await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    const existing = new Set((await loadRange(athlete.id, firstDay, lastDay, tx)).map((row) => row.workout.date));
    const created: Workout[] = [];
    const keptDays = new Set<string>();
    let skipped = 0;
    for (const entry of plan.entries) {
      const day = addDays(firstDay, entry.day - 1);
      if (day < today) {
        skipped += 1;
        continue;
      }
      const resting = Math.ceil(entry.day / DAYS_PER_WEEK) % REST_WEEK_EVERY === 0;
      const stored = await insertPlanned(tx, {
        athlete,
        date: day,
        startLocal: entry.start_local,
        sport: entry.sport,
        title: entry.title,
        shape: resting ? scaleForRest(entry) : entry.steps ? { steps: entry.steps } : { duration_s: entry.duration_s },
        source: 'plan'
      });
      created.push(stored.workout);
      if (existing.has(day)) keptDays.add(day);
    }
    if (mode === 'event') {
      await tx.query('INSERT INTO athlete_events (id, athlete_id, name, date) VALUES ($1, $2, $3, $4)', [newId(), athlete.id, (body.event_name as string).trim(), date]);
    }
    return { created: created.length, skipped, kept: keptDays.size, first_day: firstDay, last_day: lastDay, workouts: created };
  });
  publishChange(await audienceOf(athlete.id), athlete.id, mode === 'event' ? ['workouts', 'events'] : ['workouts']);
  return result;
}

// ---------------------------------------------------------------- copy week

interface CopyRequest {
  week?: unknown;
  workout_ids?: unknown;
  to_week?: unknown;
}

/** Copies planned workouts to the same weekdays of another athlete's week, skipping days that have passed. */
export async function copyWeek(source: User, target: User, today: string, body: CopyRequest): Promise<CopyResult> {
  const errors = new FieldErrors();
  errors.add('week', weekMessage(body.week));
  errors.add('to_week', weekMessage(body.to_week));
  errors.throwIfAny();
  const monday = mondayOfWeek(body.week as string);
  const week = await loadRange(source.id, monday, addDays(monday, 6), pool);
  const chosen = Array.isArray(body.workout_ids) ? new Set(body.workout_ids.map(String)) : new Set<string>();
  const picked = week.filter((row) => row.workout.kind === 'planned' && chosen.has(row.workout.id));
  if (picked.length === 0 || picked.length !== chosen.size) throw validation({ workout_ids: MESSAGES.workoutIds });

  const targetMonday = mondayOfWeek(body.to_week as string);
  const result = await transaction(async (tx) => {
    await lockAthlete(tx, target.id);
    const created: Workout[] = [];
    let skipped = 0;
    for (const { workout } of picked) {
      const day = addDays(targetMonday, weekdayIndex(workout.date));
      if (day < today) {
        skipped += 1;
        continue;
      }
      const stored = await insertPlanned(tx, {
        athlete: target,
        date: day,
        startLocal: workout.start_local,
        sport: workout.sport,
        title: workout.title,
        shape: workout.steps ? { steps: workout.steps } : { duration_s: workout.duration_s },
        source: 'copy'
      });
      created.push(stored.workout);
    }
    return { created: created.length, skipped, workouts: created };
  });
  publishChange(await audienceOf(target.id), target.id, ['workouts']);
  return result;
}
