import { JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool, transaction } from '../../db/pool.js';
import { findPlan, insertPlan, plansForOwner, upsertEvent } from '../../db/records.js';
import { toWorkout, workoutsBetween, type WorkoutRow } from '../../db/workouts.js';
import {
  applyRestWeek,
  planEntryDate,
  planFirstDay,
  PLAN_MAX_WEEKS,
  PLAN_MIN_WEEKS,
} from '../../domain/plans.js';
import { normaliseSteps, stepsDurationS, validateSteps } from '../../domain/steps.js';
import { addDays, diffDays, isValidTime, mondayOfWeek } from '../../domain/time.js';
import type { PlanEntry, Sport, Step, Workout } from '../../domain/types.js';
import { MESSAGES, Validator } from '../../domain/validation.js';
import { publishChange } from '../../services/live.js';
import { createPlanned } from '../../services/planned.js';
import { readJsonBody } from '../body.js';
import { requireCoach, visibleAthlete, type RequestContext } from '../context.js';
import { notFound, ValidationError } from '../errors.js';
import { sendJson } from '../respond.js';

export async function listPlans(ctx: RequestContext): Promise<void> {
  const coach = requireCoach(ctx);
  sendJson(ctx.res, 200, { plans: await plansForOwner(pool, coach.id) });
}

function validateEntries(
  validator: Validator,
  value: unknown,
  weeks: number | null,
): PlanEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    validator.add('entries', MESSAGES.entriesEmpty);
    return null;
  }
  const entries: PlanEntry[] = [];
  value.forEach((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const path = `entries[${index}]`;
    const maxDay = weeks === null ? 7 * PLAN_MAX_WEEKS : 7 * weeks;
    if (
      typeof entry.day !== 'number' ||
      !Number.isInteger(entry.day) ||
      entry.day < 1 ||
      entry.day > maxDay
    ) {
      validator.add(`${path}.day`, `Enter a day from 1 to ${maxDay}.`);
    }
    if (!isValidTime(entry.start_local)) validator.add(`${path}.start_local`, MESSAGES.startLocal);
    const sport = entry.sport === 'bike' || entry.sport === 'run' ? (entry.sport as Sport) : null;
    if (sport === null) validator.add(`${path}.sport`, MESSAGES.sport);
    const title =
      typeof entry.title === 'string' && entry.title.trim().length > 0 && entry.title.length <= 80
        ? entry.title.trim()
        : null;
    if (title === null) validator.add(`${path}.title`, MESSAGES.title);
    let steps: Step[] | null = null;
    let durationS = 0;
    if (entry.steps !== undefined && entry.steps !== null) {
      const message = validateSteps(entry.steps);
      if (message) validator.add(`${path}.steps`, message);
      else {
        steps = normaliseSteps(entry.steps);
        durationS = stepsDurationS(steps);
      }
    } else if (
      typeof entry.duration_s === 'number' &&
      Number.isInteger(entry.duration_s) &&
      entry.duration_s >= 60 &&
      entry.duration_s <= 86_400
    ) {
      durationS = entry.duration_s;
    } else {
      validator.add(`${path}.duration_s`, MESSAGES.durationS);
    }
    if (!validator.failed) {
      entries.push({
        day: entry.day as number,
        start_local: entry.start_local as string,
        sport: sport as Sport,
        title: title as string,
        steps,
        duration_s: durationS,
      });
    }
  });
  return validator.failed ? null : entries;
}

export async function createPlan(ctx: RequestContext): Promise<void> {
  const coach = requireCoach(ctx);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const name = validator.title('name', body.name);
  const weeks =
    typeof body.weeks === 'number' &&
    Number.isInteger(body.weeks) &&
    body.weeks >= PLAN_MIN_WEEKS &&
    body.weeks <= PLAN_MAX_WEEKS
      ? body.weeks
      : null;
  if (weeks === null) validator.add('weeks', MESSAGES.weeks);
  const entries = validateEntries(validator, body.entries, weeks);
  if (validator.failed || entries === null) throw new ValidationError(validator.fields);

  const plan = await insertPlan(pool, {
    ownerId: coach.id,
    name: name as string,
    weeks: weeks as number,
    entries,
  });
  sendJson(ctx.res, 201, { plan });
}

export async function applyPlan(ctx: RequestContext): Promise<void> {
  const coach = requireCoach(ctx);
  const plan = await findPlan(pool, ctx.params.id as string, coach.id);
  if (!plan) throw notFound();
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  if (typeof body.athlete_id !== 'string') throw notFound();
  const athlete = await visibleAthlete(ctx, body.athlete_id);

  const validator = new Validator();
  const mode = body.mode === 'start' || body.mode === 'event' ? body.mode : null;
  if (mode === null) validator.add('mode', MESSAGES.mode);
  const date = validator.date('date', body.date);
  const eventName = mode === 'event' ? validator.eventName('event_name', body.event_name) : null;
  if (validator.failed || mode === null || date === null) {
    throw new ValidationError(validator.fields);
  }

  const firstDay = planFirstDay(mode, date, plan.weeks);
  const lastDay = addDays(firstDay, 7 * plan.weeks - 1);
  const scheduled = plan.entries
    .map((entry) => applyRestWeek(entry))
    .map((entry) => ({ entry, date: planEntryDate(firstDay, entry.day) }))
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  const skipped = scheduled.filter((item) => item.date < ctx.today).length;
  const creating = scheduled.filter((item) => item.date >= ctx.today);
  const existing = await workoutsBetween(pool, athlete.id, firstDay, lastDay);
  const occupied = new Set(existing.map((row) => row.date));
  const receiving = new Set(creating.map((item) => item.date));
  const kept = [...receiving].filter((day) => occupied.has(day)).length;

  const created = await transaction(async (client) => {
    const rows: WorkoutRow[] = [];
    for (const item of creating) {
      rows.push(
        await createPlanned(client, {
          athlete,
          date: item.date,
          startLocal: item.entry.start_local,
          sport: item.entry.sport,
          title: item.entry.title,
          steps: item.entry.steps,
          durationS: item.entry.duration_s,
          source: 'plan',
        }),
      );
    }
    if (mode === 'event' && eventName !== null) {
      await upsertEvent(client, athlete.id, { name: eventName, date });
    }
    return rows;
  });

  await publishChange(athlete.id, 'workouts');
  if (mode === 'event') await publishChange(athlete.id, 'events');
  sendJson(ctx.res, 201, {
    created: created.length,
    skipped,
    kept,
    first_day: firstDay,
    last_day: lastDay,
    workouts: created.map(toWorkout),
  });
}

export async function copyWeek(ctx: RequestContext): Promise<void> {
  requireCoach(ctx);
  const source = await visibleAthlete(ctx, ctx.params.id as string);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  if (typeof body.to_athlete_id !== 'string') throw notFound();
  const target = await visibleAthlete(ctx, body.to_athlete_id);

  const validator = new Validator();
  const week = validator.week('week', body.week);
  const toWeek = validator.week('to_week', body.to_week);
  const ids = Array.isArray(body.workout_ids)
    ? body.workout_ids.filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length === 0) validator.add('workout_ids', MESSAGES.workoutIds);
  if (validator.failed || week === null || toWeek === null) {
    throw new ValidationError(validator.fields);
  }

  const sourceMonday = mondayOfWeek(week);
  const rows = await workoutsBetween(pool, source.id, sourceMonday, addDays(sourceMonday, 6));
  const chosen = rows.filter((row) => ids.includes(row.id) && row.kind === 'planned');
  if (chosen.length !== ids.length) {
    throw new ValidationError({ workout_ids: MESSAGES.workoutIds });
  }

  const targetMonday = mondayOfWeek(toWeek);
  const planned = chosen.map((row) => ({
    row,
    date: addDays(targetMonday, diffDays(row.date, sourceMonday)),
  }));
  const skipped = planned.filter((item) => item.date < ctx.today).length;
  const creating = planned.filter((item) => item.date >= ctx.today);

  const created = await transaction(async (client) => {
    const rowsCreated: WorkoutRow[] = [];
    for (const item of creating) {
      rowsCreated.push(
        await createPlanned(client, {
          athlete: target,
          date: item.date,
          startLocal: item.row.start_local,
          sport: item.row.sport,
          title: item.row.title,
          steps: item.row.steps,
          durationS: item.row.duration_s,
          source: 'copy',
        }),
      );
    }
    return rowsCreated;
  });

  await publishChange(target.id, 'workouts');
  const workouts: Workout[] = created.map(toWorkout);
  sendJson(ctx.res, 201, { created: created.length, skipped, workouts });
}
