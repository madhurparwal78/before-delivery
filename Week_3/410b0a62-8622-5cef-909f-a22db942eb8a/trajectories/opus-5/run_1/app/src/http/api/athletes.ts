import { JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool, transaction } from '../../db/pool.js';
import {
  eventsForAthlete,
  seriesBetween,
  thresholdExists,
  thresholdHistory,
  thresholdSpanEnd,
  upsertThreshold,
} from '../../db/records.js';
import { findUser } from '../../db/users.js';
import { latestCompleted, toWorkout } from '../../db/workouts.js';
import { isoWeekOf, isValidDate, isValidWeek } from '../../domain/time.js';
import type { AthleteSummary, ThresholdKind } from '../../domain/types.js';
import { MESSAGES, Validator } from '../../domain/validation.js';
import { recomputeSeriesFrom, rescoreThresholdSpan, seriesStartOf } from '../../services/scoring.js';
import { publishChange } from '../../services/live.js';
import { buildWeek, buildWeeks, itemForWorkout } from '../../services/views.js';
import { readJsonBody } from '../body.js';
import {
  requireUser,
  visibleAthlete,
  visibleAthleteIds,
  type RequestContext,
} from '../context.js';
import { ValidationError } from '../errors.js';
import { sendJson } from '../respond.js';

export async function listAthletes(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const ids = await visibleAthleteIds(user);
  const athletes: AthleteSummary[] = [];
  for (const id of ids) {
    const athlete = await findUser(pool, id);
    if (!athlete) continue;
    const week = await buildWeek(pool, athlete, isoWeekOf(ctx.today), ctx.today);
    const [latestRow] = await latestCompleted(pool, id, 1);
    const latest = latestRow
      ? await itemForWorkout(pool, id, toWorkout(latestRow), ctx.today)
      : null;
    athletes.push({
      id: athlete.id,
      name: athlete.name,
      tz: athlete.tz,
      week: { week: week.week, planned_tss: week.planned_tss, completed_tss: week.completed_tss },
      latest,
    });
  }
  sendJson(ctx.res, 200, { athletes });
}

export async function getAthlete(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  sendJson(ctx.res, 200, {
    id: athlete.id,
    name: athlete.name,
    tz: athlete.tz,
    series_start: seriesStartOf(athlete, ctx.today),
    thresholds: await thresholdHistory(pool, athlete.id),
    events: await eventsForAthlete(pool, athlete.id),
  });
}

function countParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(12, Math.max(0, parsed));
}

export async function getWeeks(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  const requested = ctx.url.searchParams.get('week');
  if (requested !== null && !isValidWeek(requested)) {
    throw new ValidationError({ week: MESSAGES.week });
  }
  const centre = requested ?? isoWeekOf(ctx.today);
  const before = countParam(ctx.url, 'before', 4);
  const after = countParam(ctx.url, 'after', 4);
  const weeks = await buildWeeks(pool, athlete, centre, before, after, ctx.today);
  sendJson(ctx.res, 200, { today: ctx.today, weeks });
}

export async function getSeries(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  const seriesStart = seriesStartOf(athlete, ctx.today);
  const fromParam = ctx.url.searchParams.get('from');
  const toParam = ctx.url.searchParams.get('to');
  const validator = new Validator();
  if (fromParam !== null && !isValidDate(fromParam)) validator.add('from', MESSAGES.date);
  if (toParam !== null && !isValidDate(toParam)) validator.add('to', MESSAGES.date);
  if (validator.failed) throw new ValidationError(validator.fields);
  const from = fromParam ?? seriesStart;
  const to = toParam ?? ctx.today;
  sendJson(ctx.res, 200, { days: await seriesBetween(pool, athlete.id, from, to) });
}

export async function postThreshold(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const kind: ThresholdKind | null =
    body.kind === 'ftp' || body.kind === 'pace' ? body.kind : null;
  if (kind === null) validator.add('kind', MESSAGES.thresholdKind);
  const value = kind === null ? null : validator.thresholdValue('value', kind, body.value);
  const effectiveFrom = validator.date('effective_from', body.effective_from);
  if (validator.failed || kind === null || value === null || effectiveFrom === null) {
    throw new ValidationError(validator.fields);
  }

  const replaced = await thresholdExists(pool, athlete.id, kind, effectiveFrom);
  const result = await transaction(async (client) => {
    await upsertThreshold(client, athlete.id, {
      kind,
      value,
      effective_from: effectiveFrom,
    });
    const spanEnd = await thresholdSpanEnd(client, athlete.id, kind, effectiveFrom);
    const rescored = await rescoreThresholdSpan(
      client,
      athlete.id,
      kind,
      value,
      effectiveFrom,
      spanEnd,
    );
    const seriesFrom = await recomputeSeriesFrom(client, athlete, effectiveFrom, ctx.today);
    return { rescored, seriesFrom };
  });
  await publishChange(athlete.id, 'thresholds');
  await publishChange(athlete.id, 'series');
  await publishChange(athlete.id, 'workouts');
  sendJson(ctx.res, replaced ? 200 : 201, {
    threshold: { kind, value, effective_from: effectiveFrom },
    rescored: result.rescored,
    series_from: result.seriesFrom,
  });
}
