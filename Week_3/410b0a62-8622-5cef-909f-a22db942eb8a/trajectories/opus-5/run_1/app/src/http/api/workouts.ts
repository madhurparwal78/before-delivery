import { randomUUID } from 'node:crypto';
import { JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool, transaction } from '../../db/pool.js';
import {
  commentsForWorkout,
  findLibraryItem,
  insertComment,
  thresholdOn,
} from '../../db/records.js';
import { acceptedCoachIds } from '../../db/users.js';
import {
  deleteWorkoutRow,
  findWorkout,
  toWorkout,
  updatePlanned,
  workoutsOnDay,
  type WorkoutRow,
} from '../../db/workouts.js';
import { dayItems } from '../../domain/compliance.js';
import { formatTss } from '../../domain/display.js';
import { normaliseSteps, plannedIf, plannedTss, stepsDurationS, validateSteps } from '../../domain/steps.js';
import type { Step, Workout } from '../../domain/types.js';
import { MESSAGES, Validator } from '../../domain/validation.js';
import { insertCompleted } from '../../services/completed.js';
import { publishChange, publishNotice } from '../../services/live.js';
import { createPlanned, startUtcFor } from '../../services/planned.js';
import { recomputeSeriesFrom, seriesStartOf, thresholdOfSport } from '../../services/scoring.js';
import { itemForWorkout } from '../../services/views.js';
import { activityObjectKey, deleteActivityObject, getActivityObject, StorageUnavailableError } from '../../storage/s3.js';
import { readJsonBody } from '../body.js';
import { requireUser, visibleAthlete, type RequestContext } from '../context.js';
import { ApiError, notFound, originalStorageUnavailable, ValidationError } from '../errors.js';
import { sendJson, sendNoContent } from '../respond.js';

const STALE = new ApiError(
  409,
  'stale',
  'This workout changed since you opened it. Reload to see the latest.',
);
const LOCKED = new ApiError(409, 'locked', 'Completed sessions stay on their day.');

async function loadVisibleWorkout(ctx: RequestContext, id: string): Promise<WorkoutRow> {
  const row = await findWorkout(pool, id);
  if (!row) throw notFound();
  await visibleAthlete(ctx, row.athlete_id);
  return row;
}

export async function createWorkout(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const date = validator.date('date', body.date);
  if (date !== null && date < ctx.today) validator.add('date', MESSAGES.datePast);
  const sport = validator.sport('sport', body.sport);
  const title = validator.title('title', body.title);
  const startLocal =
    body.start_local === undefined || body.start_local === null
      ? null
      : validator.startLocal('start_local', body.start_local);

  const given = ['steps', 'duration_s', 'library_id'].filter(
    (field) => body[field] !== undefined && body[field] !== null,
  );
  let steps: Step[] | null = null;
  let durationS: number | null = null;
  if (given.length !== 1) {
    validator.add('steps', MESSAGES.stepsEmpty);
  } else if (given[0] === 'steps') {
    const message = validateSteps(body.steps);
    if (message) validator.add('steps', message);
    else steps = normaliseSteps(body.steps);
  } else if (given[0] === 'duration_s') {
    durationS = validator.durationS('duration_s', body.duration_s);
  }

  if (given[0] === 'library_id' && !validator.failed) {
    const item =
      typeof body.library_id === 'string'
        ? await findLibraryItem(pool, body.library_id, requireUser(ctx).id)
        : null;
    if (!item) throw notFound();
    steps = item.steps;
  }
  if (validator.failed) throw new ValidationError(validator.fields);

  const row = await createPlanned(pool, {
    athlete,
    date: date as string,
    startLocal,
    sport: sport as 'bike' | 'run',
    title: title as string,
    steps,
    durationS,
    source: given[0] === 'library_id' ? 'library' : 'builder',
  });
  await publishChange(athlete.id, 'workouts', { workoutId: row.id });
  sendJson(ctx.res, 201, { workout: toWorkout(row) });
}

export async function getWorkout(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  const workout = toWorkout(row);
  sendJson(ctx.res, 200, {
    workout,
    item: await itemForWorkout(pool, row.athlete_id, workout, ctx.today),
    comments: await commentsForWorkout(pool, row.id),
  });
}

async function isPaired(row: WorkoutRow, today: string): Promise<boolean> {
  const rows = await workoutsOnDay(pool, row.athlete_id, row.date);
  const planned = rows.filter((candidate) => candidate.kind === 'planned').map(toWorkout);
  const completed = rows.filter((candidate) => candidate.kind === 'completed').map(toWorkout);
  const items = dayItems(planned, completed, row.date, today);
  return items.some(
    (item) =>
      item.ratio !== null && (item.planned?.id === row.id || item.completed?.id === row.id),
  );
}

export async function patchWorkout(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  const athlete = await visibleAthlete(ctx, row.athlete_id);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const date = body.date === undefined ? row.date : validator.date('date', body.date);
  if (date !== null && date !== row.date && date < ctx.today) {
    validator.add('date', MESSAGES.datePast);
  }
  const title = body.title === undefined ? row.title : validator.title('title', body.title);
  const startLocal =
    body.start_local === undefined
      ? row.start_local
      : body.start_local === null
        ? null
        : validator.startLocal('start_local', body.start_local);
  let steps: Step[] | null = row.steps;
  if (body.steps !== undefined) {
    const message = validateSteps(body.steps);
    if (message) validator.add('steps', message);
    else steps = normaliseSteps(body.steps);
  }
  if (validator.failed) throw new ValidationError(validator.fields);

  if (body.version !== row.version) throw STALE;
  const movingDay = date !== row.date;
  if (movingDay && (row.kind === 'completed' || (await isPaired(row, ctx.today)))) throw LOCKED;

  const updated = await updatePlanned(pool, row.id, {
    date: date as string,
    startLocal,
    startUtc: startUtcFor(date as string, startLocal, athlete.tz),
    title: title as string,
    steps,
    durationS: steps ? stepsDurationS(steps) : row.duration_s,
    plannedTss: steps ? plannedTss(steps) : row.planned_tss,
    plannedIf: steps ? plannedIf(steps) : row.planned_if,
  });
  await publishChange(athlete.id, 'workouts', { workoutId: row.id });
  sendJson(ctx.res, 200, { workout: toWorkout(updated) });
}

export async function deleteWorkout(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  const athlete = await visibleAthlete(ctx, row.athlete_id);
  if (row.file_name) {
    const extension = row.file_content_type === 'text/csv' ? 'csv' : 'json';
    try {
      await deleteActivityObject(activityObjectKey(athlete.id, row.id, extension));
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw originalStorageUnavailable();
      throw error;
    }
  }
  await transaction(async (client) => {
    await deleteWorkoutRow(client, row.id);
    if (row.kind === 'completed') await recomputeSeriesFrom(client, athlete, row.date, ctx.today);
  });
  await publishChange(athlete.id, 'workouts', { workoutId: row.id });
  if (row.kind === 'completed') await publishChange(athlete.id, 'series');
  sendNoContent(ctx.res);
}

export async function createManual(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const date = validator.date('date', body.date);
  if (date !== null) {
    if (date > ctx.today) validator.add('date', MESSAGES.dateFuture);
    else if (date < seriesStartOf(athlete, ctx.today)) {
      validator.add('date', MESSAGES.dateBeforeHistory);
    }
  }
  const sport = validator.sport('sport', body.sport);
  const title = validator.title('title', body.title);
  const durationS = validator.durationS('duration_s', body.duration_s);
  const avgPower = sport === 'bike' ? validator.avgPower('avg_power_w', body.avg_power_w) : null;
  const avgPace =
    sport === 'run' ? validator.avgPace('avg_pace_s_per_km', body.avg_pace_s_per_km) : null;
  if (validator.failed) throw new ValidationError(validator.fields);

  const threshold = await thresholdOn(
    pool,
    athlete.id,
    thresholdOfSport(sport as 'bike' | 'run'),
    date as string,
  );
  if (threshold === null) {
    throw new ValidationError({
      threshold: sport === 'bike' ? MESSAGES.noFtp : MESSAGES.noPace,
    });
  }
  const normalised = sport === 'bike' ? (avgPower as number) : 1000 / (avgPace as number);
  const row = await transaction((client) =>
    insertCompleted(
      client,
      {
        id: randomUUID(),
        athlete,
        sport: sport as 'bike' | 'run',
        title: title as string,
        date: date as string,
        startLocal: null,
        startUtc: null,
        durationS: durationS as number,
        normalised,
        threshold,
        source: 'manual',
        file: null,
      },
      ctx.today,
    ),
  );
  await announceCompleted(athlete.id, athlete.name, toWorkout(row));
  sendJson(ctx.res, 201, { workout: toWorkout(row) });
}

export async function announceCompleted(
  athleteId: string,
  athleteName: string,
  workout: Workout,
): Promise<void> {
  await publishChange(athleteId, 'workouts', { workoutId: workout.id });
  await publishChange(athleteId, 'series');
  const coaches = await acceptedCoachIds(pool, athleteId);
  publishNotice(
    coaches,
    `${athleteName} logged ${workout.title}: ${formatTss(workout.tss as number)} TSS.`,
  );
}

export async function getOriginal(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  if (!row.file_name) throw notFound();
  const extension = row.file_content_type === 'text/csv' ? 'csv' : 'json';
  try {
    const object = await getActivityObject(activityObjectKey(row.athlete_id, row.id, extension));
    ctx.res.writeHead(200, {
      'content-type': row.file_content_type as string,
      'content-length': object.body.length,
      'content-disposition': `attachment; filename="${row.file_name}"`,
      'x-content-sha256': row.file_sha256 as string,
    });
    ctx.res.end(object.body);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw originalStorageUnavailable();
    throw error;
  }
}

export async function listComments(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  sendJson(ctx.res, 200, { comments: await commentsForWorkout(pool, row.id) });
}

export async function createComment(ctx: RequestContext): Promise<void> {
  const row = await loadVisibleWorkout(ctx, ctx.params.id as string);
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const text = validator.body('body', body.body);
  if (validator.failed) throw new ValidationError(validator.fields);

  const id = await insertComment(pool, {
    workoutId: row.id,
    authorId: user.id,
    body: text as string,
  });
  const comments = await commentsForWorkout(pool, row.id);
  const comment = comments.find((candidate) => candidate.id === id);
  await publishChange(row.athlete_id, 'comments', { workoutId: row.id });
  const coaches = await acceptedCoachIds(pool, row.athlete_id);
  const audience = [row.athlete_id, ...coaches].filter((candidate) => candidate !== user.id);
  publishNotice(audience, `${user.name} commented on ${row.title}.`);
  sendJson(ctx.res, 201, { comment });
}
