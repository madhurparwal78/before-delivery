import { query, queryOne } from './pool.js';
import type { Category, Format, Visibility } from '../domain/model.js';
import { withinPlanIds, isReadOnly } from '../domain/model.js';
import type { ModelState } from '../domain/states.js';
import type { PlanName } from '../domain/plans.js';
import type { Camera, Hotspot } from '../shared/viewer.js';

interface ModelDbRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: Category;
  state: ModelState;
  visibility: Visibility;
  owner_user_id: number;
  owner_email: string;
  owner_role: string;
  password_hash: string | null;
  share_token: string | null;
  unlock_epoch: number;
  personal_cents: number;
  commercial_cents: number | null;
  studio_cents: number | null;
  discount_percent: number;
  edition_total: number | null;
  edition_price_cents: number | null;
  scale_denominator: number;
  formats: Format[];
  width_mm: string;
  height_mm: string;
  depth_mm: string;
  bounding_radius_mm: string;
  default_camera: Camera;
  hotspots: Hotspot[];
  first_published_at: Date | null;
  created_at: Date;
}

export interface ModelRecord {
  readonly id: number;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly state: ModelState;
  readonly visibility: Visibility;
  readonly ownerUserId: number;
  readonly ownerEmail: string;
  readonly ownerRole: string;
  readonly passwordHash: string | null;
  readonly shareToken: string | null;
  readonly unlockEpoch: number;
  readonly personalCents: number;
  readonly commercialCents: number | null;
  readonly studioCents: number | null;
  readonly discountPercent: number;
  readonly editionTotal: number | null;
  readonly editionPriceCents: number | null;
  readonly scaleDenominator: number;
  readonly formats: readonly Format[];
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  readonly boundingRadiusMm: number;
  readonly defaultCamera: Camera;
  readonly hotspots: readonly Hotspot[];
  readonly firstPublishedAt: Date | null;
  readonly createdAt: Date;
  /** Derived from the active plan's limit and the publication ranking. */
  readonly withinPlan: boolean;
  readonly readOnly: boolean;
}

const SELECT = `
  SELECT m.*, u.email AS owner_email, u.role AS owner_role
  FROM models m JOIN users u ON u.id = m.owner_user_id`;

function toRecord(row: ModelDbRow, within: ReadonlySet<number>): ModelRecord {
  const withinPlan = row.state !== 'published' || within.has(row.id);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    state: row.state,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    ownerRole: row.owner_role,
    passwordHash: row.password_hash,
    shareToken: row.share_token,
    unlockEpoch: row.unlock_epoch,
    personalCents: row.personal_cents,
    commercialCents: row.commercial_cents,
    studioCents: row.studio_cents,
    discountPercent: row.discount_percent,
    editionTotal: row.edition_total,
    editionPriceCents: row.edition_price_cents,
    scaleDenominator: row.scale_denominator,
    formats: row.formats,
    widthMm: Number(row.width_mm),
    heightMm: Number(row.height_mm),
    depthMm: Number(row.depth_mm),
    boundingRadiusMm: Number(row.bounding_radius_mm),
    // The published field order, which a JSONB round trip does not keep.
    defaultCamera: {
      azimuth: row.default_camera.azimuth,
      tilt: row.default_camera.tilt,
      distance: row.default_camera.distance,
      fov: row.default_camera.fov,
    },
    hotspots: row.hotspots.map((h) => ({
      label: h.label,
      x_mm: h.x_mm,
      y_mm: h.y_mm,
      z_mm: h.z_mm,
    })),
    firstPublishedAt: row.first_published_at,
    createdAt: row.created_at,
    withinPlan,
    readOnly: isReadOnly({ state: row.state, withinPlan }),
  };
}

interface RankRow {
  id: number;
  state: ModelState;
  first_published_at: Date | null;
}

/** The published models the active plan's limit keeps. */
export async function withinPlanSet(planName: PlanName): Promise<ReadonlySet<number>> {
  const rows = await query<RankRow>(
    `SELECT id, state, first_published_at FROM models WHERE state = 'published'`,
  );
  return withinPlanIds(
    rows.map((r) => ({ id: r.id, state: r.state, firstPublishedAt: r.first_published_at })),
    planName,
  );
}

export async function findModelBySlug(
  slug: string,
  planName: PlanName,
): Promise<ModelRecord | null> {
  const row = await queryOne<ModelDbRow>(`${SELECT} WHERE m.slug = $1`, [slug]);
  if (row === null) return null;
  return toRecord(row, await withinPlanSet(planName));
}

export async function findModelByShareToken(
  token: string,
  planName: PlanName,
): Promise<ModelRecord | null> {
  const row = await queryOne<ModelDbRow>(`${SELECT} WHERE m.share_token = $1`, [token]);
  if (row === null) return null;
  return toRecord(row, await withinPlanSet(planName));
}

export async function findModelByEmbedToken(
  token: string,
  planName: PlanName,
): Promise<ModelRecord | null> {
  const row = await queryOne<ModelDbRow>(
    `${SELECT} JOIN embeds e ON e.model_id = m.id WHERE e.token = $1`,
    [token],
  );
  if (row === null) return null;
  return toRecord(row, await withinPlanSet(planName));
}

export async function findModelById(
  id: number,
  planName: PlanName,
): Promise<ModelRecord | null> {
  const row = await queryOne<ModelDbRow>(`${SELECT} WHERE m.id = $1`, [id]);
  if (row === null) return null;
  return toRecord(row, await withinPlanSet(planName));
}

export async function allModels(planName: PlanName): Promise<readonly ModelRecord[]> {
  const rows = await query<ModelDbRow>(`${SELECT} ORDER BY m.created_at, m.id`);
  const within = await withinPlanSet(planName);
  return rows.map((r) => toRecord(r, within));
}

export async function modelsOwnedBy(
  userId: number,
  planName: PlanName,
): Promise<readonly ModelRecord[]> {
  const rows = await query<ModelDbRow>(
    `${SELECT} WHERE m.owner_user_id = $1 ORDER BY m.created_at, m.id`,
    [userId],
  );
  const within = await withinPlanSet(planName);
  return rows.map((r) => toRecord(r, within));
}

export interface Totals {
  readonly public: number;
  readonly unlisted: number;
  readonly password: number;
  readonly private: number;
  readonly draft: number;
  readonly in_review: number;
  readonly withdrawn: number;
}

interface TotalsRow {
  visibility: Visibility;
  state: ModelState;
  n: string;
}

/** Counters always equal a recount of their rows. */
export async function catalogueTotals(): Promise<Totals> {
  const rows = await query<TotalsRow>(
    `SELECT visibility, state, count(*)::text AS n FROM models GROUP BY visibility, state`,
  );
  const totals = {
    public: 0,
    unlisted: 0,
    password: 0,
    private: 0,
    draft: 0,
    in_review: 0,
    withdrawn: 0,
  };
  for (const row of rows) {
    const n = Number(row.n);
    if (row.state === 'published') totals[row.visibility] += n;
    if (row.state === 'draft') totals.draft += n;
    if (row.state === 'in_review') totals.in_review += n;
    if (row.state === 'withdrawn') totals.withdrawn += n;
  }
  return totals;
}

export interface RevisionRecord {
  readonly id: number;
  readonly revision: number;
  readonly originalSha256: string;
  readonly originalFilename: string;
  readonly sourceUnit: string;
  readonly publishedAt: Date | null;
}

interface RevisionDbRow {
  id: number;
  revision: number;
  original_sha256: string;
  original_filename: string;
  source_unit: string;
  published_at: Date | null;
}

function toRevision(row: RevisionDbRow): RevisionRecord {
  return {
    id: row.id,
    revision: row.revision,
    originalSha256: row.original_sha256,
    originalFilename: row.original_filename,
    sourceUnit: row.source_unit,
    publishedAt: row.published_at,
  };
}

/** The newest revision, published or not. */
export async function newestRevision(modelId: number): Promise<RevisionRecord | null> {
  const row = await queryOne<RevisionDbRow>(
    `SELECT * FROM revisions WHERE model_id = $1 ORDER BY revision DESC LIMIT 1`,
    [modelId],
  );
  return row === null ? null : toRevision(row);
}

/** The newest revision whose publish stage has confirmed. */
export async function currentRevision(modelId: number): Promise<RevisionRecord | null> {
  const row = await queryOne<RevisionDbRow>(
    `SELECT * FROM revisions
     WHERE model_id = $1 AND published_at IS NOT NULL
     ORDER BY revision DESC LIMIT 1`,
    [modelId],
  );
  return row === null ? null : toRevision(row);
}

/**
 * A replaced source marks the current files outdated the moment it is accepted,
 * so a model is rebuilding while its newest revision has not published yet.
 */
export async function isRebuilding(modelId: number): Promise<boolean> {
  const newest = await newestRevision(modelId);
  if (newest === null) return false;
  return newest.publishedAt === null;
}

export async function derivativeKey(
  revisionId: number,
  kind: 'glb' | 'stl' | 'preview',
): Promise<string | null> {
  const row = await queryOne<{ object_key: string }>(
    `SELECT object_key FROM derivatives WHERE revision_id = $1 AND kind = $2`,
    [revisionId, kind],
  );
  return row?.object_key ?? null;
}

/** Ends every earlier unlock of a password-protected model. */
export async function bumpUnlockEpoch(modelId: number): Promise<void> {
  await query(`UPDATE models SET unlock_epoch = unlock_epoch + 1 WHERE id = $1`, [modelId]);
}
