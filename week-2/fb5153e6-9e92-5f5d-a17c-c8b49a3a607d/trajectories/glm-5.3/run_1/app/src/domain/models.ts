import { query, one, withTransaction, type DbClient } from '../db/db.js';
import { ApiError } from '../errors.js';
import { planOf, type PlanId } from './plans.js';
import { canMove, type ModelState, type Role } from './states.js';
import { discountedPrice } from './money.js';
import { putDoc, deleteDoc, type SearchDoc } from '../providers/search.js';

export interface ModelRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  state: ModelState;
  visibility: 'public' | 'unlisted' | 'private' | 'password';
  password_epoch: number;
  owner_id: number;
  revision: number;
  revision_count: number;
  has_glb: boolean;
  has_stl: boolean;
  width_mm: string;
  height_mm: string;
  depth_mm: string;
  bounding_radius_mm: string;
  scale_denominator: number;
  cam_azimuth: number;
  cam_tilt: number;
  cam_distance_factor: number;
  cam_fov: number;
  hotspots: { label: string; x_mm: number; y_mm: number; z_mm: number }[];
  price_personal_cents: number;
  price_commercial_cents: number | null;
  price_studio_cents: number | null;
  discount_percent: number;
  edition_total: number | null;
  edition_price_cents: number | null;
  edition_sales: number;
  first_published_at: string | null;
  publish_seq: string | null;
  source_unit: string;
  source_name: string;
  read_only: boolean;
  rebuilding: boolean;
  outdated: boolean;
  index_state: 'out' | 'dirty' | 'in' | 'pending_removal';
  created_at: string;
}

export interface RevisionRow {
  id: number;
  revision_no: number;
  source_checksum: string;
  source_name: string;
  source_size: number;
  source_unit: string;
  current: boolean;
  dims_set: boolean;
  width_mm: string | null;
  height_mm: string | null;
  depth_mm: string | null;
  bounding_radius_mm: string | null;
}

export const MODEL_COLUMNS = `id, slug, title, description, category, state, visibility, password_epoch, owner_id,
  revision, revision_count, has_glb, has_stl, width_mm, height_mm, depth_mm, bounding_radius_mm,
  scale_denominator, cam_azimuth, cam_tilt, cam_distance_factor, cam_fov, hotspots,
  price_personal_cents, price_commercial_cents, price_studio_cents, discount_percent,
  edition_total, edition_price_cents, edition_sales, first_published_at, publish_seq,
  source_unit, source_name, read_only, rebuilding, outdated, index_state, created_at`;

export async function getModelBySlug(slug: string): Promise<ModelRow | null> {
  return one<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE slug = $1`, [slug]);
}

export async function getModelById(id: number): Promise<ModelRow | null> {
  return one<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE id = $1`, [id]);
}

export async function getRevision(modelId: number, revisionNo: number): Promise<RevisionRow | null> {
  return one<RevisionRow>(
    `SELECT id, revision_no, source_checksum, source_name, source_size, source_unit, current,
       dims_set, width_mm, height_mm, depth_mm, bounding_radius_mm
     FROM model_revisions WHERE model_id = $1 AND revision_no = $2`,
    [modelId, revisionNo],
  );
}

export async function newestRevision(modelId: number): Promise<RevisionRow | null> {
  return one<RevisionRow>(
    `SELECT id, revision_no, source_checksum, source_name, source_size, source_unit, current,
       dims_set, width_mm, height_mm, depth_mm, bounding_radius_mm
     FROM model_revisions WHERE model_id = $1 ORDER BY revision_no DESC LIMIT 1`,
    [modelId],
  );
}

/** The single visibility filter for every derived surface. */
export function indexedEligible(model: ModelRow): boolean {
  return model.state === 'published' && model.visibility === 'public' && !model.read_only;
}

export function searchDocOf(model: ModelRow): SearchDoc {
  const licences: string[] = ['personal'];
  if (model.price_commercial_cents !== null) licences.push('commercial');
  if (model.price_studio_cents !== null) licences.push('studio');
  const formats: string[] = [];
  if (model.has_glb) formats.push('glb');
  if (model.has_stl) formats.push('stl');
  return {
    slug: model.slug,
    title: model.title,
    description: model.description,
    category: model.category,
    licences,
    formats,
    price_from_cents: discountedPrice(model.price_personal_cents, model.discount_percent),
    published_at: Math.floor(new Date(model.first_published_at ?? model.created_at).getTime() / 1000),
    rebuilding: model.rebuilding,
  };
}

export interface IndexOutcome {
  state: 'in' | 'out';
}

/** Applies index changes for a model: writes or removes the search document. Throws when search is unreachable. */
export async function reconcileModelIndex(modelId: number): Promise<IndexOutcome> {
  return withTransaction(async client => {
    const row = await client.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE id = $1 FOR UPDATE`, [modelId]);
    const model = row.rows[0];
    if (model === undefined) return { state: 'out' };
    const eligible = indexedEligible(model);
    if (eligible && model.index_state !== 'in') {
      await putDoc(searchDocOf(model));
      await client.query(`UPDATE models SET index_state = 'in' WHERE id = $1`, [modelId]);
      return { state: 'in' };
    }
    if (!eligible && model.index_state !== 'out') {
      await deleteDoc(model.slug);
      await client.query(`UPDATE models SET index_state = 'out' WHERE id = $1`, [modelId]);
      return { state: 'out' };
    }
    return { state: model.index_state === 'in' ? 'in' : 'out' };
  });
}

export async function hasPendingRemovals(): Promise<boolean> {
  const row = await one<{ count: string }>(`SELECT count(*)::text AS count FROM models WHERE index_state = 'pending_removal'`);
  return (row?.count ?? '0') !== '0';
}

/** Reconciler sweep: applies pending index changes. Failures leave state for the next sweep. */
export async function reconcileAllIndexes(): Promise<number> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM models WHERE index_state IN ('dirty', 'pending_removal') ORDER BY id LIMIT 50`,
  );
  let applied = 0;
  for (const row of rows.rows) {
    try {
      await reconcileModelIndex(row.id);
      applied += 1;
    } catch {
      // Search unreachable or write failed; retry next sweep.
    }
  }
  return applied;
}

/** The single within-plan ranking: published models ordered by first publish; over-limit become read-only. */
export async function recomputeReadOnly(client: DbClient, planId: PlanId): Promise<void> {
  const plan = planOf(planId);
  if (plan.publishedModelsLimit === null) {
    await client.query(`UPDATE models SET read_only = false WHERE state = 'published'`);
    return;
  }
  const published = await client.query<{ id: number; read_only: boolean }>(
    `SELECT id, read_only FROM models WHERE state = 'published' ORDER BY publish_seq ASC NULLS LAST, id ASC`,
  );
  for (let i = 0; i < published.rows.length; i++) {
    const row = published.rows[i];
    const shouldBe = i >= plan.publishedModelsLimit;
    if (row !== undefined && row.read_only !== shouldBe) {
      await client.query(`UPDATE models SET read_only = $2 WHERE id = $1`, [row.id, shouldBe]);
      if (shouldBe) {
        await client.query(`UPDATE models SET index_state = 'pending_removal' WHERE id = $1 AND index_state <> 'out'`, [row.id]);
      } else {
        await client.query(`UPDATE models SET index_state = 'dirty' WHERE id = $1 AND index_state <> 'in'`, [row.id]);
      }
    }
  }
}

export interface TransitionContext {
  role: Role;
  userId: number;
  isOwner: boolean;
}

/** Applies a state transition: legality, readiness, quota, ranking and index effects — the single place. */
export async function applyTransition(
  slug: string,
  to: ModelState,
  ctx: TransitionContext,
  options: { countQuota?: boolean } = {},
): Promise<{ slug: string; state: ModelState }> {
  return withTransaction(async client => {
    const row = await client.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE slug = $1 FOR UPDATE`, [slug]);
    const model = row.rows[0];
    if (model === undefined) throw new ApiError(404, 'not_found');
    if (model.read_only && to !== 'withdrawn') throw new ApiError(409, 'read_only');

    const planRow = await client.query('SELECT plan FROM plan_state WHERE id = 1');
    const plan = planOf(planRow.rows[0]?.plan ?? 'free');

    if (!canMove(model.state, to, ctx.role, ctx.isOwner)) {
      throw new ApiError(409, 'illegal_transition', { from: model.state, to });
    }

    const wasIndexed = indexedEligible(model);

    if (to === 'published') {
      if (!(await currentRevisionPublishConfirmed(client, model))) throw new ApiError(409, 'not_ready');
      if (options.countQuota !== false) {
        const cycle = await currentCycleBounds(client);
        const used = await countPublishes(client, cycle);
        if (plan.publishesPerCycle !== null && used >= plan.publishesPerCycle) {
          throw new ApiError(409, 'quota_reached', { limit: plan.publishesPerCycle });
        }
      }
      await client.query(
        `UPDATE models SET state = 'published', publish_seq = COALESCE(publish_seq, nextval('model_publish_seq')),
           first_published_at = COALESCE(first_published_at, now())
         WHERE id = $1`,
        [model.id],
      );
      if (options.countQuota !== false) {
        await client.query('INSERT INTO publish_events (model_id) VALUES ($1)', [model.id]);
      }
    } else {
      await client.query(`UPDATE models SET state = $2 WHERE id = $1`, [model.id, to]);
    }

    if (model.state === 'published' && to !== 'published') {
      // Leaving published ends its share link, password unlocks and embeds.
      await client.query('DELETE FROM share_tokens WHERE model_id = $1', [model.id]);
      await client.query('DELETE FROM embeds WHERE model_id = $1', [model.id]);
      await client.query('UPDATE models SET password_epoch = password_epoch + 1 WHERE id = $1', [model.id]);
    }

    await recomputeReadOnly(client, plan.id);

    const after = await client.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE id = $1`, [model.id]);
    const afterModel = after.rows[0];
    if (afterModel !== undefined) {
      const eligibleNow = indexedEligible(afterModel);
      if (eligibleNow) {
        await client.query(`UPDATE models SET index_state = 'dirty' WHERE id = $1 AND index_state <> 'in'`, [model.id]);
      } else {
        await client.query(
          `UPDATE models SET index_state = CASE WHEN index_state = 'out' THEN 'out' ELSE 'pending_removal' END WHERE id = $1`,
          [model.id],
        );
      }
    }
    return { slug: model.slug, state: to };
  });
}

async function currentRevisionPublishConfirmed(client: DbClient, model: ModelRow): Promise<boolean> {
  if (model.revision === 0) return false;
  const revision = await client.query<{ id: number }>(
    `SELECT id FROM model_revisions WHERE model_id = $1 AND revision_no = $2`,
    [model.id, model.revision],
  );
  const revisionRow = revision.rows[0];
  if (revisionRow === undefined) return false;
  const stage = await client.query<{ status: string }>(
    `SELECT us.status FROM upload_stages us JOIN uploads u ON u.ref = us.upload_ref
     WHERE u.revision_id = $1 AND us.name = 'publish'`,
    [revisionRow.id],
  );
  return stage.rows[0]?.status === 'confirmed';
}

export interface CycleBounds {
  start: Date;
  end: Date;
  resetsOn: string;
}

export function cycleBounds(billingCycleDay: number, now = new Date()): CycleBounds {
  const bcd = Math.min(Math.max(billingCycleDay, 1), 31);
  const start = dateWithDay(now.getUTCFullYear(), now.getUTCMonth(), bcd);
  if (start.getTime() > now.getTime()) {
    const prev = dateWithDay(now.getUTCFullYear(), now.getUTCMonth() - 1, bcd);
    return { start: prev, end: start, resetsOn: isoDate(start) };
  }
  const next = dateWithDay(now.getUTCFullYear(), now.getUTCMonth() + 1, bcd);
  return { start, end: next, resetsOn: isoDate(next) };
}

function dateWithDay(year: number, monthIndex: number, day: number): Date {
  const yearAdjusted = year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(yearAdjusted, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yearAdjusted, month, Math.min(day, lastDay)));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function currentCycleBounds(client: DbClient): Promise<CycleBounds> {
  const row = await client.query<{ billing_cycle_day: number }>('SELECT billing_cycle_day FROM plan_state WHERE id = 1');
  return cycleBounds(row.rows[0]?.billing_cycle_day ?? 1);
}

export async function countPublishes(client: DbClient, cycle: CycleBounds): Promise<number> {
  const row = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM publish_events WHERE created_at >= $1 AND created_at < $2`,
    [cycle.start, cycle.end],
  );
  return Number(row.rows[0]?.count ?? '0');
}

export interface StudioSummary {
  totals: { public: number; unlisted: number; password: number; private: number; draft: number; in_review: number; withdrawn: number };
  quota: { used: number; limit: number | null; resets_on: string };
  collections: { slug: string; name: string; item_count: number }[];
}

/** Derived counters, always equal to a recount of their rows. */
export async function studioSummary(client: DbClient): Promise<StudioSummary> {
  const counts = await client.query<{ visibility: string; state: string; count: string }>(
    `SELECT visibility, state, count(*)::text AS count FROM models GROUP BY visibility, state`,
  );
  const totals = { public: 0, unlisted: 0, password: 0, private: 0, draft: 0, in_review: 0, withdrawn: 0 };
  for (const row of counts.rows) {
    const count = Number(row.count);
    if (row.state === 'published') {
      if (row.visibility === 'public') totals.public += count;
      else if (row.visibility === 'unlisted') totals.unlisted += count;
      else if (row.visibility === 'password') totals.password += count;
      else totals.private += count;
    }
    if (row.state === 'draft') totals.draft += count;
    else if (row.state === 'in_review') totals.in_review += count;
    else if (row.state === 'withdrawn') totals.withdrawn += count;
  }
  const cycle = await currentCycleBounds(client);
  const planRow = await client.query<{ plan: string }>('SELECT plan FROM plan_state WHERE id = 1');
  const plan = planOf(planRow.rows[0]?.plan ?? 'free');
  const used = await countPublishes(client, cycle);
  const collections = await client.query<{ slug: string; name: string; item_count: string }>(
    `SELECT c.slug, c.name, count(ci.model_id)::text AS item_count
     FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id
     GROUP BY c.id, c.slug, c.name ORDER BY c.name`,
  );
  return {
    totals,
    quota: { used, limit: plan.publishesPerCycle, resets_on: cycle.resetsOn },
    collections: collections.rows.map(row => ({ slug: row.slug, name: row.name, item_count: Number(row.item_count) })),
  };
}
