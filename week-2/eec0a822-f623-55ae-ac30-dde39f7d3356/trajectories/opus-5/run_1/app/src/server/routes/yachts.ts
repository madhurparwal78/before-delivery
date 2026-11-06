import { query } from '../db.js';
import { conflict } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { Fields } from '../domain/validate.js';
import { crewOf, listYachts, requireYacht, yachtProfileJson, yachtRates } from '../records.js';
import { availabilityWindow, type Season } from '../domain/weeks.js';
import { weekSummaries } from '../domain/holds.js';
import { weeklyRateMinor } from '../domain/pricing.js';
import { json, today } from './helpers.js';

const MIN_RATE_MINOR = 100000;
const MAX_RATE_MINOR = 100000000;

async function list(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'yachts_read');
  const yachts = await listYachts(actor.workspaceId);
  const visible =
    actor.role === 'crew_member' ? yachts.filter((yacht) => yacht.id === actor.yachtId) : yachts;
  const profiles = [];
  for (const yacht of visible) {
    profiles.push(yachtProfileJson(yacht, await crewOf(yacht.id)));
  }
  return json(200, { yachts: profiles });
}

async function read(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'yachts_read');
  return json(200, { yacht: yachtProfileJson(yacht, await crewOf(yacht.id)) });
}

async function patch(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'yacht_profile');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const name = 'name' in body ? fields.text('name', body.name, 80) : yacht.name;
  const cabins = 'cabins' in body ? fields.wholeNumber('cabins', body.cabins, 2, 6) : yacht.cabins;
  const lengthCm = 'lengthM' in body ? fields.metres('lengthM', body.lengthM, 800, 4000) : yacht.length_cm;
  const beamCm = 'beamM' in body ? fields.metres('beamM', body.beamM, 300, 1500) : yacht.beam_cm;
  const draftCm = 'draftM' in body ? fields.metres('draftM', body.draftM, 50, 300) : yacht.draft_cm;
  const rates = readRates(fields, body, yacht);
  fields.throwIfFailed();
  await query(
    `UPDATE yachts SET name = $2, cabins = $3, length_cm = $4, beam_cm = $5, draft_cm = $6,
        rate_low_minor = $7, rate_shoulder_minor = $8, rate_high_minor = $9
      WHERE id = $1`,
    [yacht.id, name, cabins, lengthCm, beamCm, draftCm, rates.low, rates.shoulder, rates.high],
  );
  const updated = await requireYacht(actor, ctx.params.yachtSlug);
  return json(200, { yacht: yachtProfileJson(updated, await crewOf(updated.id)) });
}

function readRates(
  fields: Fields,
  body: Record<string, unknown>,
  yacht: { rate_low_minor: string; rate_shoulder_minor: string; rate_high_minor: string },
): { low: number; shoulder: number; high: number } {
  const given = body.rates;
  const source: Record<string, unknown> =
    given !== null && typeof given === 'object' && !Array.isArray(given)
      ? (given as Record<string, unknown>)
      : {};
  const read = (key: string, stored: string): number =>
    key in source
      ? fields.wholeNumber(`rates.${key}`, source[key], MIN_RATE_MINOR, MAX_RATE_MINOR)
      : Number(stored);
  return {
    low: read('lowMinor', yacht.rate_low_minor),
    shoulder: read('shoulderMinor', yacht.rate_shoulder_minor),
    high: read('highMinor', yacht.rate_high_minor),
  };
}

async function setStatus(ctx: Ctx, next: 'withdrawn' | 'on_sale'): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'yacht_profile');
  if (yacht.status === next) {
    throw conflict(next === 'withdrawn' ? 'already_withdrawn' : 'already_on_sale');
  }
  await query('UPDATE yachts SET status = $2 WHERE id = $1', [yacht.id, next]);
  const updated = await requireYacht(actor, ctx.params.yachtSlug);
  return json(200, { yacht: yachtProfileJson(updated, await crewOf(updated.id)) });
}

async function weeks(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'yachts_read');
  const summaries = await weekSummaries(
    yacht.id,
    availabilityWindow(today(ctx.now)),
    (season) => weeklyRateMinor(yachtRates(yacht), season as Season),
    yacht.currency,
    ctx.now,
  );
  return json(200, { weeks: summaries });
}

export function registerYachtRoutes(router: Router): void {
  router.add('/api/w/:ws/yachts', { GET: list });
  router.add('/api/w/:ws/yachts/:yachtSlug', { GET: read, PATCH: patch });
  router.add('/api/w/:ws/yachts/:yachtSlug/withdraw', {
    POST: (ctx) => setStatus(ctx, 'withdrawn'),
  });
  router.add('/api/w/:ws/yachts/:yachtSlug/return-to-sale', {
    POST: (ctx) => setStatus(ctx, 'on_sale'),
  });
  router.add('/api/w/:ws/yachts/:yachtSlug/weeks', { GET: weeks });
}
