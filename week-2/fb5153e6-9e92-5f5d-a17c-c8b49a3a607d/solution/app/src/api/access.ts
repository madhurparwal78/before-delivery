import type { RequestContext } from '../http/router.js';
import { ApiError, notFound } from '../http/errors.js';
import type { ModelRecord } from '../db/models.js';
import { findModelByShareToken, findModelBySlug, isRebuilding } from '../db/models.js';
import { activePlan, activePlanState } from '../db/plan.js';
import { editionAvailability } from '../db/editions.js';
import { plan } from '../domain/plans.js';
import type { LicenceType } from '../domain/money.js';
import { discountedPriceCents, seatsFor } from '../domain/money.js';
import { sign, unsign } from '../http/cookies.js';
import { sessionSecret } from '../db/users.js';

/** A model is reachable in public only while published and within plan. */
function publiclyLive(model: ModelRecord): boolean {
  return model.state === 'published' && model.withinPlan;
}

export function unlockCookieName(slug: string): string {
  return `ts_unlock_${slug.replace(/[^a-z0-9-]/g, '')}`;
}

/** An unlock ends when the password, visibility, state or plan standing changes. */
export async function hasValidUnlock(
  ctx: RequestContext,
  model: ModelRecord,
): Promise<boolean> {
  const cookie = ctx.cookies[unlockCookieName(model.slug)];
  if (cookie === undefined) return false;
  const value = unsign(cookie, await sessionSecret());
  return value === `${model.slug}:${model.unlockEpoch}`;
}

export async function unlockCookieValue(model: ModelRecord): Promise<string> {
  return sign(`${model.slug}:${model.unlockEpoch}`, await sessionSecret());
}

/**
 * `/models/<slug>` serves a public model, or a password model once unlocked.
 * Unlisted, private, withdrawn and over-limit models are not found here.
 */
export async function resolvePublicModel(
  ctx: RequestContext,
  slug: string,
): Promise<ModelRecord> {
  const model = await findModelBySlug(slug, await activePlan());
  if (model === null || !publiclyLive(model)) throw notFound();
  if (model.visibility === 'public') return model;
  if (model.visibility === 'password') {
    if (await hasValidUnlock(ctx, model)) return model;
    throw new ApiError('password_required');
  }
  throw notFound();
}

/** An unlisted model is reachable only through its share link. */
export async function resolveSharedModel(token: string): Promise<ModelRecord> {
  const model = await findModelByShareToken(token, await activePlan());
  if (model === null || !publiclyLive(model) || model.visibility !== 'unlisted') throw notFound();
  return model;
}

/**
 * A model a buyer may reach: public, an unlisted model named by its share
 * token, or a password model this browser has unlocked.
 */
export async function resolvePurchasableModel(
  ctx: RequestContext,
  slug: string,
  access: string | null,
): Promise<ModelRecord> {
  const model = await findModelBySlug(slug, await activePlan());
  if (model === null || !publiclyLive(model)) throw notFound();
  switch (model.visibility) {
    case 'public':
      return model;
    case 'unlisted':
      if (access !== null && access === model.shareToken) return model;
      throw notFound();
    case 'password':
      if (await hasValidUnlock(ctx, model)) return model;
      throw new ApiError('password_required');
    case 'private':
      throw notFound();
  }
}

export interface LicenceLine {
  readonly type: LicenceType;
  readonly seats: number;
  readonly list_price_cents: number;
  readonly price_cents: number;
}

export function licenceLines(model: ModelRecord): readonly LicenceLine[] {
  const lines: LicenceLine[] = [];
  const add = (type: LicenceType, list: number): void => {
    lines.push({
      type,
      seats: seatsFor(type),
      list_price_cents: list,
      price_cents: discountedPriceCents(list, model.discountPercent),
    });
  };
  add('personal', model.personalCents);
  if (model.commercialCents !== null) add('commercial', model.commercialCents);
  if (model.studioCents !== null) add('studio', model.studioCents);
  return lines;
}

export interface EditionBlock {
  readonly total: number;
  readonly remaining: number;
  readonly price_cents: number;
}

export async function editionBlock(model: ModelRecord): Promise<EditionBlock | null> {
  if (model.editionTotal === null || model.editionPriceCents === null) return null;
  const availability = await editionAvailability(model.id, model.editionTotal, true);
  return {
    total: availability.total,
    remaining: availability.remaining,
    price_cents: model.editionPriceCents,
  };
}

export interface ModelDetail {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly formats: readonly string[];
  readonly licences: readonly LicenceLine[];
  readonly discount_percent: number;
  readonly dimensions_mm: { readonly width: number; readonly height: number; readonly depth: number };
  readonly bounding_radius_mm: number;
  readonly scale_denominator: number;
  readonly default_camera: { readonly azimuth: number; readonly tilt: number; readonly distance: number; readonly fov: number };
  readonly hotspots: readonly { readonly label: string; readonly x_mm: number; readonly y_mm: number; readonly z_mm: number }[];
  readonly edition: EditionBlock | null;
  readonly rebuilding: boolean;
}

export async function modelDetail(model: ModelRecord): Promise<ModelDetail> {
  return {
    slug: model.slug,
    title: model.title,
    category: model.category,
    description: model.description,
    formats: model.formats,
    licences: licenceLines(model),
    discount_percent: model.discountPercent,
    dimensions_mm: { width: model.widthMm, height: model.heightMm, depth: model.depthMm },
    bounding_radius_mm: model.boundingRadiusMm,
    scale_denominator: model.scaleDenominator,
    default_camera: model.defaultCamera,
    hotspots: model.hotspots,
    edition: await editionBlock(model),
    rebuilding: await isRebuilding(model.id),
  };
}

/** The embed page and its media are checked against all of these on every request. */
export async function embedIsLive(model: ModelRecord): Promise<boolean> {
  const state = await activePlanState();
  if (!plan(state.plan).embeds) return false;
  if (model.state !== 'published' || !model.withinPlan) return false;
  return model.visibility === 'public' || model.visibility === 'unlisted';
}
