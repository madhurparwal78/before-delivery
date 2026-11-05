import type { Reply, RequestContext } from '../http/router.js';
import { bytes, empty, json } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import type { FieldError } from '../http/errors.js';
import { requireAuthor, requireAuthorOrEditor } from './guards.js';
import type { ModelRecord } from '../db/models.js';
import {
  allModels,
  bumpUnlockEpoch,
  catalogueTotals,
  currentRevision,
  findModelBySlug,
  newestRevision,
} from '../db/models.js';
import { query, queryOne } from '../db/pool.js';
import { activePlan, activePlanState, quotaFor, recordPublish, refreshPlanState } from '../db/plan.js';
import { isPlanName, isUpgrade, plan } from '../domain/plans.js';
import type { PlanName } from '../domain/plans.js';
import { belongsInSearchIndex, isCategory, isVisibility } from '../domain/model.js';
import type { Visibility } from '../domain/model.js';
import {
  edgeAllows,
  isLegalEdge,
  leavesPublished,
  needsConfirmedRevision,
  spendsQuota,
} from '../domain/states.js';
import type { ModelState } from '../domain/states.js';
import { isModelState } from '../domain/states.js';
import { graphemeLength } from '../domain/text.js';
import { isValidDiscountPercent, isValidPriceCents } from '../domain/money.js';
import { isValidCamera, MAX_HOTSPOTS } from '../shared/viewer.js';
import type { Camera, Hotspot } from '../shared/viewer.js';
import { hashPassword } from '../domain/session.js';
import { newToken, newKeyRef, newReadKey } from '../domain/identifiers.js';
import { editionHasSale } from '../db/editions.js';
import { latestUploadForModel, findUploadByRef, queueStatusFor } from '../db/uploads.js';
import { requeueUpload } from '../queue/worker.js';
import { acceptUpload, uploadAcceptedReply } from './uploads.js';
import { modelDetail } from './access.js';
import {
  syncModel,
  hasUnconfirmedRemoval,
  priceFromCents,
  queueIndexWork,
  resyncForPlan,
} from '../services/indexer.js';
import { getObject, objectKeys } from '../services/s3.js';
import { allDocumentsNewestFirst } from '../services/search.js';
import { buildCatalogueCsv } from './export.js';
import { withIdempotency } from '../db/idempotency.js';
import { changePlan } from '../services/killbill.js';
import { sendDowngradeEmail, sendUpgradeEmail } from '../services/emails.js';
import { authorUser } from '../db/users.js';
import { hashReadKey } from '../db/seed.js';

async function loadStudioModel(slug: string): Promise<ModelRecord> {
  const model = await findModelBySlug(slug, await activePlan());
  if (model === null) throw notFound();
  return model;
}

export async function summaryHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const state = await activePlanState();
  const collections = await query<{ slug: string; name: string; item_count: string }>(
    `SELECT c.slug, c.name, count(i.model_id)::text AS item_count
     FROM collections c LEFT JOIN collection_items i ON i.collection_id = c.id
     GROUP BY c.id ORDER BY c.created_at, c.id`,
  );
  return json(200, {
    totals: await catalogueTotals(),
    quota: await quotaFor(state),
    collections: collections.map((c) => ({
      slug: c.slug,
      name: c.name,
      item_count: Number(c.item_count),
    })),
  });
}

export async function modelsHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const wanted = ctx.query.get('state');
  if (wanted !== null && !isModelState(wanted)) {
    throw validationFailed([fieldError('state', 'choose_one')]);
  }
  const models = await allModels(await activePlan());
  const items = [];
  for (const model of models) {
    if (wanted !== null && model.state !== wanted) continue;
    items.push({
      slug: model.slug,
      title: model.title,
      state: model.state,
      visibility: model.visibility,
      read_only: model.readOnly,
      price_from_cents: priceFromCents(model),
      queue_status: await queueStatusFor(model.id),
    });
  }
  return json(200, { items });
}

async function studioDetail(model: ModelRecord): Promise<Record<string, unknown>> {
  const detail = await modelDetail(model);
  const embeds = await query<{ token: string }>(
    `SELECT token FROM embeds WHERE model_id = $1 ORDER BY id`,
    [model.id],
  );
  const revision = await newestRevision(model.id);
  const upload = await latestUploadForModel(model.id);
  return {
    ...detail,
    state: model.state,
    visibility: model.visibility,
    read_only: model.readOnly,
    revision: revision?.revision ?? 0,
    share_url: model.shareToken === null ? null : `/u/${model.shareToken}`,
    embeds: embeds.map((e) => ({ token: e.token, url: `/embed/${e.token}` })),
    latest_upload: upload?.uploadRef ?? null,
    owner: model.ownerRole === 'author' ? 'author' : model.ownerEmail,
  };
}

export async function modelDetailHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  return json(200, await studioDetail(await loadStudioModel(ctx.params.slug ?? '')));
}

const PATCH_FIELDS = new Set([
  'title',
  'description',
  'category',
  'visibility',
  'password',
  'prices',
  'discount_percent',
  'edition_total',
  'edition_price_cents',
]);

interface PriceUpdate {
  readonly personal: number;
  readonly commercial: number | null;
  readonly studio: number | null;
}

function readPrices(raw: unknown, errors: FieldError[], model: ModelRecord): PriceUpdate | null {
  if (raw === undefined) return null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(fieldError('price', 'price'));
    return null;
  }
  const record = raw as Record<string, unknown>;
  const read = (key: string, fallback: number | null): number | null => {
    if (!(key in record)) return fallback;
    const value = record[key];
    if (value === null) return null;
    if (typeof value !== 'number' || !isValidPriceCents(value)) {
      errors.push(fieldError('price', 'price'));
      return fallback;
    }
    return value;
  };
  const personal = read('personal_cents', model.personalCents);
  if (personal === null) {
    errors.push(fieldError('price', 'price'));
    return null;
  }
  return {
    personal,
    commercial: read('commercial_cents', model.commercialCents),
    studio: read('studio_cents', model.studioCents),
  };
}

export async function patchModelHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  if (model.readOnly) throw new ApiError('read_only');

  const raw = ctx.body;
  const unknown = Object.keys(raw).filter((k) => !PATCH_FIELDS.has(k));
  if (unknown.length > 0) {
    throw validationFailed(unknown.map((name) => fieldError(name, 'unknown')));
  }

  const planState = await activePlanState();
  if ('edition_total' in raw && !plan(planState.plan).editions) {
    throw new ApiError('not_in_plan');
  }
  if ('edition_total' in raw && (await editionHasSale(model.id))) {
    throw new ApiError('edition_locked');
  }

  const errors: FieldError[] = [];
  const updates: Record<string, unknown> = {};

  if ('title' in raw) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const length = graphemeLength(title);
    if (length < 1 || length > 120) errors.push(fieldError('title', 'title'));
    else updates.title = title;
  }
  if ('description' in raw) {
    const description = typeof raw.description === 'string' ? raw.description : '';
    if (graphemeLength(description) > 2000) errors.push(fieldError('description', 'description'));
    else updates.description = description;
  }
  if ('category' in raw) {
    if (!isCategory(raw.category)) errors.push(fieldError('category', 'choose_one'));
    else updates.category = raw.category;
  }
  if ('discount_percent' in raw) {
    const discount = raw.discount_percent;
    if (typeof discount !== 'number' || !isValidDiscountPercent(discount)) {
      errors.push(fieldError('discount', 'discount'));
    } else updates.discount_percent = discount;
  }
  if ('edition_total' in raw) {
    const total = raw.edition_total;
    if (total === null) updates.edition_total = null;
    else if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 1 || total > 500) {
      errors.push(fieldError('edition_total', 'edition_total'));
    } else updates.edition_total = total;
  }
  if ('edition_price_cents' in raw) {
    const price = raw.edition_price_cents;
    if (price === null) updates.edition_price_cents = null;
    else if (typeof price !== 'number' || !isValidPriceCents(price)) {
      errors.push(fieldError('price', 'price'));
    } else updates.edition_price_cents = price;
  }

  const prices = readPrices(raw.prices, errors, model);
  if (prices !== null) {
    updates.personal_cents = prices.personal;
    updates.commercial_cents = prices.commercial;
    updates.studio_cents = prices.studio;
  }

  let newVisibility: Visibility | null = null;
  let passwordHash: string | null | undefined;
  if ('visibility' in raw) {
    if (!isVisibility(raw.visibility)) errors.push(fieldError('visibility', 'choose_one'));
    else newVisibility = raw.visibility;
  }
  const passwordGiven = 'password' in raw && typeof raw.password === 'string';
  const targetVisibility = newVisibility ?? model.visibility;
  if (targetVisibility === 'password') {
    if (passwordGiven) {
      const password = String(raw.password);
      if (password.length < 8 || password.length > 64) errors.push(fieldError('password', 'password'));
      else passwordHash = await hashPassword(password);
    } else if (model.visibility !== 'password' || model.passwordHash === null) {
      errors.push(fieldError('password', 'password'));
    }
  } else if (passwordGiven) {
    const password = String(raw.password);
    if (password.length < 8 || password.length > 64) errors.push(fieldError('password', 'password'));
    else passwordHash = await hashPassword(password);
  }

  if (errors.length > 0) throw validationFailed(errors);

  if (newVisibility !== null) updates.visibility = newVisibility;
  if (passwordHash !== undefined) updates.password_hash = passwordHash;
  if (newVisibility !== null && newVisibility !== 'password') updates.password_hash = null;

  // Leaving unlisted, or changing to it, ends the old share token at once.
  if (newVisibility !== null && newVisibility !== model.visibility) {
    updates.share_token = newVisibility === 'unlisted' ? newToken('shr_') : null;
  }

  const columns = Object.keys(updates);
  if (columns.length > 0) {
    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await query(`UPDATE models SET ${assignments}, updated_at = now() WHERE id = $1`, [
      model.id,
      ...columns.map((c) => updates[c]),
    ]);
  }

  const passwordChanged = passwordHash !== undefined;
  const visibilityChanged = newVisibility !== null && newVisibility !== model.visibility;
  if (passwordChanged || visibilityChanged) await bumpUnlockEpoch(model.id);

  const updated = await loadStudioModel(model.slug);
  await syncModel(updated);
  return json(200, await studioDetail(updated));
}

function readHotspots(raw: unknown, model: ModelRecord, errors: FieldError[]): readonly Hotspot[] {
  if (!Array.isArray(raw)) {
    errors.push(fieldError('hotspots', 'hotspots'));
    return [];
  }
  if (raw.length > MAX_HOTSPOTS) {
    errors.push(fieldError('hotspots', 'hotspots'));
    return [];
  }
  const halfWidth = model.widthMm / 2;
  const halfHeight = model.heightMm / 2;
  const halfDepth = model.depthMm / 2;
  const out: Hotspot[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      errors.push(fieldError('hotspots', 'hotspots'));
      return [];
    }
    const h = entry as Record<string, unknown>;
    const label = typeof h.label === 'string' ? h.label : '';
    const x = h.x_mm;
    const y = h.y_mm;
    const z = h.z_mm;
    const labelLength = graphemeLength(label);
    if (
      labelLength < 1 ||
      labelLength > 60 ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      Math.abs(x) > halfWidth + 1e-6 ||
      Math.abs(y) > halfHeight + 1e-6 ||
      Math.abs(z) > halfDepth + 1e-6
    ) {
      errors.push(fieldError('hotspots', 'hotspots'));
      return [];
    }
    out.push({ label, x_mm: x, y_mm: y, z_mm: z });
  }
  return out;
}

export async function saveViewHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  if (model.readOnly) throw new ApiError('read_only');

  const errors: FieldError[] = [];
  const rawCamera = ctx.body.default_camera;
  let camera: Camera = model.defaultCamera;
  if (rawCamera === null || typeof rawCamera !== 'object' || Array.isArray(rawCamera)) {
    errors.push(fieldError('camera', 'camera'));
  } else {
    const c = rawCamera as Record<string, unknown>;
    const candidate: Camera = {
      azimuth: Number(c.azimuth),
      tilt: Number(c.tilt),
      distance: Number(c.distance),
      fov: Number(c.fov),
    };
    if (!isValidCamera(candidate)) errors.push(fieldError('camera', 'camera'));
    else camera = candidate;
  }
  const hotspots = readHotspots(ctx.body.hotspots, model, errors);
  if (errors.length > 0) throw validationFailed(errors);

  await query(
    `UPDATE models SET default_camera = $2, hotspots = $3, updated_at = now() WHERE id = $1`,
    [model.id, JSON.stringify(camera), JSON.stringify(hotspots)],
  );
  return json(200, await studioDetail(await loadStudioModel(model.slug)));
}

export async function transitionHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireAuthorOrEditor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  const to = ctx.body.to;
  if (!isModelState(to)) throw validationFailed([fieldError('to', 'choose_one')]);

  if (model.readOnly && to !== 'withdrawn') throw new ApiError('read_only');
  const mover = session.role === 'editor' ? 'editor' : 'author';
  if (!isLegalEdge(model.state, to) || !edgeAllows(model.state, to, mover)) {
    throw new ApiError('illegal_transition', { params: { from: model.state, to } });
  }

  if (needsConfirmedRevision(to) && (await currentRevision(model.id)) === null) {
    throw new ApiError('not_ready');
  }
  if (spendsQuota(to)) {
    const quota = await quotaFor(await activePlanState());
    if (quota.limit !== null && quota.used >= quota.limit) {
      throw new ApiError('quota_reached', { params: { limit: quota.limit } });
    }
  }

  await applyTransition(model, to);
  return json(200, { slug: model.slug, state: to });
}

/** Every move to published spends a publish and sets the first publication. */
export async function applyTransition(model: ModelRecord, to: ModelState): Promise<void> {
  await query(
    `UPDATE models SET state = $2,
       first_published_at = CASE WHEN $2 = 'published' AND first_published_at IS NULL
                                 THEN now() ELSE first_published_at END,
       updated_at = now()
     WHERE id = $1`,
    [model.id, to],
  );
  if (spendsQuota(to)) await recordPublish(model.id);
  if (leavesPublished(model.state, to)) {
    // Share links, password unlocks and embeds end with the model's publication.
    await query(`UPDATE models SET share_token = NULL WHERE id = $1`, [model.id]);
    await query(`DELETE FROM embeds WHERE model_id = $1`, [model.id]);
    await bumpUnlockEpoch(model.id);
  }
  const after = await findModelBySlug(model.slug, await activePlan());
  // A move between two states both outside the search set has no document to write or remove.
  if (after !== null && belongsInSearchIndex(model) !== belongsInSearchIndex(after)) {
    await syncModel(after);
  }
}

export async function deleteModelHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  if (model.state !== 'draft') throw new ApiError('not_deletable');
  await query(`DELETE FROM models WHERE id = $1`, [model.id]);
  await syncModel(model).catch(() => undefined);
  return empty(204);
}

export async function uploadHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireAuthor(ctx);
  const planName = await activePlan();
  const slug = ctx.form?.field('model') ?? null;
  let existing: ModelRecord | null = null;
  if (slug !== null) {
    existing = await loadStudioModel(slug);
    if (existing.readOnly) throw new ApiError('read_only');
  }
  const accepted = await acceptUpload(ctx, planName, session.userId, existing);
  return uploadAcceptedReply(accepted, (s) => `/studio/models/${s}/queue`);
}

export function uploadPayload(upload: {
  uploadRef: string;
  modelSlug: string;
  status: string;
  stages: readonly { name: string; status: string; attempts: number; nextAttemptAt: Date | null }[];
}): Record<string, unknown> {
  return {
    upload: upload.uploadRef,
    model: upload.modelSlug,
    status: upload.status,
    stages: upload.stages.map((stage) => ({
      name: stage.name,
      status: stage.status,
      attempts: stage.attempts,
      next_attempt_at: stage.nextAttemptAt?.toISOString() ?? null,
    })),
  };
}

export async function uploadStatusHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const upload = await findUploadByRef(ctx.params.ref ?? '');
  if (upload === null) throw notFound();
  return json(200, uploadPayload(upload));
}

export async function requeueHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const upload = await findUploadByRef(ctx.params.ref ?? '');
  if (upload === null) throw notFound();
  if (upload.status !== 'failed') throw new ApiError('not_failed');
  await requeueUpload(upload.id);
  const after = await findUploadByRef(upload.uploadRef);
  if (after === null) throw notFound();
  return json(202, uploadPayload(after));
}

/** The original comes back byte for byte, with its content checksum. */
export async function originalHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  return serveOriginal(model);
}

export async function serveOriginal(model: ModelRecord): Promise<Reply> {
  const revision = await newestRevision(model.id);
  if (revision === null) throw notFound();
  const body = await getObject(objectKeys.original(revision.originalSha256));
  if (body === null) throw notFound();
  return bytes(200, 'application/octet-stream', body, {
    headers: {
      'Content-Disposition': `attachment; filename="${revision.originalFilename}"`,
      'X-Checksum-SHA256': revision.originalSha256,
    },
  });
}

export async function shareLinkHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  if (model.readOnly) throw new ApiError('read_only');
  if (model.visibility !== 'unlisted') throw new ApiError('visibility_conflict');
  const token = newToken('shr_');
  await query(`UPDATE models SET share_token = $2 WHERE id = $1`, [model.id, token]);
  return json(201, { share_url: `/u/${token}` });
}

export async function createEmbedHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const model = await loadStudioModel(ctx.params.slug ?? '');
  const state = await activePlanState();
  if (!plan(state.plan).embeds) throw new ApiError('not_in_plan');
  if (model.readOnly) throw new ApiError('read_only');
  if (model.state !== 'published' || (model.visibility !== 'public' && model.visibility !== 'unlisted')) {
    throw new ApiError('visibility_conflict');
  }
  const token = newToken('emb_');
  await query(`INSERT INTO embeds (token, model_id) VALUES ($1, $2)`, [token, model.id]);
  return json(201, { token, url: `/embed/${token}` });
}

export async function deleteEmbedHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const removed = await query<{ id: number }>(
    `DELETE FROM embeds WHERE token = $1 RETURNING id`,
    [ctx.params.token ?? ''],
  );
  if (removed.length === 0) throw notFound();
  return empty(204);
}

export async function exportHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  if (await hasUnconfirmedRemoval()) throw new ApiError('search_unavailable');
  const documents = await allDocumentsNewestFirst();
  return bytes(200, 'text/csv; charset=utf-8', Buffer.from(buildCatalogueCsv(documents), 'utf8'), {
    headers: { 'Content-Disposition': 'attachment; filename="catalogue.csv"' },
  });
}

async function planPayload(): Promise<Record<string, unknown>> {
  const state = await refreshPlanState();
  return {
    plan: state.plan,
    pending:
      state.pendingPlan === null || state.pendingEffectiveDate === null
        ? null
        : { plan: state.pendingPlan, effective_date: state.pendingEffectiveDate },
    billing_cycle_day: state.billingCycleDay,
    confirmed_at: state.confirmedAt,
    quota: await quotaFor(state),
  };
}

export async function planHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  // A read never reports the half-way state of a change that is still running.
  await planChangeSettled();
  return json(200, await planPayload());
}

/** Plan changes run one at a time; reads wait for the one in flight. */
let planChangeTail: Promise<unknown> = Promise.resolve();

function planChangeSettled(): Promise<void> {
  return planChangeTail.then(
    () => undefined,
    () => undefined,
  );
}

function serialisePlanChange(work: () => Promise<Reply>): Promise<Reply> {
  const run = planChangeSettled().then(work);
  planChangeTail = run;
  return run;
}

async function runPlanChange(target: PlanName): Promise<Reply> {
  const state = await refreshPlanState();
  if (state.plan === target) throw new ApiError('plan_unchanged');
  if (state.accountId === null || state.subscriptionId === null) {
    throw new ApiError('billing_unavailable');
  }
  const upgrade = isUpgrade(state.plan, target);
  const result = await changePlan(state.accountId, state.subscriptionId, target, upgrade);
  const after = await refreshPlanState();
  const author = await authorUser();

  if (upgrade) {
    await sendUpgradeEmail(author.email, target, result.chargedCents, after.confirmedAt ?? '');
    await queueIndexWork(() => resyncForPlan(after.plan));
    return json(200, {
      plan: after.plan,
      pending: null,
      charged_cents: result.chargedCents,
      redirect: '/studio/plan',
    });
  }

  const effectiveDate = after.pendingEffectiveDate ?? result.effectiveDate;
  if (effectiveDate !== null) await sendDowngradeEmail(author.email, target, effectiveDate);
  return json(202, {
    plan: after.plan,
    pending: effectiveDate === null ? null : { plan: target, effective_date: effectiveDate },
    redirect: '/studio/plan',
  });
}

export async function changePlanHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const target = ctx.body.plan;
  if (!isPlanName(target)) throw validationFailed([fieldError('plan', 'choose_one')]);
  const key = ctx.idempotencyKey;
  if (key === null) throw new ApiError('idempotency_key_required');
  return serialisePlanChange(() =>
    withIdempotency('plan', key, ctx.body, async () => runPlanChange(target)),
  );
}

export async function listKeysHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const rows = await query<{ key_ref: string; name: string; created_at: Date; revoked_at: Date | null }>(
    `SELECT key_ref, name, created_at, revoked_at FROM read_keys ORDER BY created_at, id`,
  );
  return json(200, {
    items: rows.map((r) => ({
      ref: r.key_ref,
      name: r.name,
      created_at: r.created_at.toISOString(),
      active: r.revoked_at === null,
    })),
  });
}

export async function createKeyHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const state = await activePlanState();
  const active = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM read_keys WHERE revoked_at IS NULL`,
  );
  if (Number(active?.n ?? '0') >= plan(state.plan).readKeys) throw new ApiError('not_in_plan');

  const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
  const length = graphemeLength(name);
  if (length < 1 || length > 60) throw validationFailed([fieldError('name', 'name')]);
  const clash = await queryOne<{ id: number }>(
    `SELECT id FROM read_keys WHERE lower(name) = lower($1) AND revoked_at IS NULL`,
    [name],
  );
  if (clash !== null) throw validationFailed([fieldError('name', 'name')]);

  const ref = newKeyRef();
  const key = newReadKey();
  const row = await queryOne<{ created_at: Date }>(
    `INSERT INTO read_keys (key_ref, name, key_hash) VALUES ($1, $2, $3) RETURNING created_at`,
    [ref, name, hashReadKey(key)],
  );
  return json(201, {
    ref,
    name,
    key,
    created_at: (row?.created_at ?? new Date()).toISOString(),
  });
}

export async function revokeKeyHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthor(ctx);
  const revoked = await query<{ id: number }>(
    `UPDATE read_keys SET revoked_at = now() WHERE key_ref = $1 AND revoked_at IS NULL RETURNING id`,
    [ctx.params.ref ?? ''],
  );
  if (revoked.length === 0) throw notFound();
  return empty(204);
}


