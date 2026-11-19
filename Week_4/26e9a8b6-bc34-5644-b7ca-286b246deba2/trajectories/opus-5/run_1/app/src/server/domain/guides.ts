import { randomUUID } from 'node:crypto';
import { execute, query, queryOne } from '../db/index.js';
import { formatCost, guideTotal, runningCost } from '../../shared/cost.js';
import type {
  Axis,
  Callout,
  Currency,
  ForkCredit,
  GuideReading,
  GuideState,
  GuideWorking,
  ModelRecord,
  Part,
  Phase,
  ReaderStep,
  SessionUser,
  Step,
  Visibility,
} from '../../shared/types.js';

export interface GuideRow extends Record<string, unknown> {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  currency: Currency;
  tags: string[];
  visibility: Visibility;
  state: GuideState;
  published_version: number | null;
  model_id: string | null;
  model_scale: number;
  model_scale_confirmed: boolean;
  revision: number;
  forked_from_guide_id: string | null;
  forked_from_title: string | null;
  forked_from_author: string | null;
  forked_from_version: number | null;
}

export interface StepRow extends Record<string, unknown> {
  id: string;
  guide_id: string;
  position: number;
  title: string;
  body_text: string;
  phase: Phase;
  explode: number;
  focus_parts: string[];
  yaw: number;
  pitch: number;
  zoom: number;
  callouts: Callout[];
}

export interface PartRow extends Record<string, unknown> {
  id: string;
  guide_id: string;
  position: number;
  name: string;
  node_path: string | null;
  axis: Axis;
  apart_mm: number;
  quantity: number;
  unit_price: number;
  fitted_at: string | null;
  bbox_min: number[];
  bbox_max: number[];
  colour: number[];
}

export interface ModelRow extends Record<string, unknown> {
  id: string;
  bytes: string | number;
  sha256: string;
  bbox_mm: number[];
}

const GUIDE_COLUMNS = `id, slug, owner_id, title, currency, tags, visibility, state,
  published_version, model_id, model_scale, model_scale_confirmed, revision,
  forked_from_guide_id, forked_from_title, forked_from_author, forked_from_version`;

export async function loadGuide(idOrSlug: string): Promise<GuideRow | null> {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  return await queryOne<GuideRow>(
    `SELECT ${GUIDE_COLUMNS} FROM guides WHERE ${byId ? 'id = $1' : 'slug = $1'}`,
    [idOrSlug],
  );
}

export async function loadSteps(guideId: string): Promise<StepRow[]> {
  return await query<StepRow>(
    `SELECT id, guide_id, position, title, body_text, phase, explode, focus_parts, yaw, pitch, zoom, callouts
     FROM steps WHERE guide_id = $1 ORDER BY position`,
    [guideId],
  );
}

export async function loadParts(guideId: string): Promise<PartRow[]> {
  return await query<PartRow>(
    `SELECT id, guide_id, position, name, node_path, axis, apart_mm, quantity, unit_price,
            fitted_at, bbox_min, bbox_max, colour
     FROM parts WHERE guide_id = $1 ORDER BY position`,
    [guideId],
  );
}

export async function loadModel(modelId: string | null): Promise<ModelRow | null> {
  if (modelId === null) return null;
  return await queryOne<ModelRow>('SELECT id, bytes, sha256, bbox_mm FROM models WHERE id = $1', [
    modelId,
  ]);
}

export async function coauthorIds(guideId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    'SELECT user_id FROM guide_coauthors WHERE guide_id = $1',
    [guideId],
  );
  return rows.map((row) => row.user_id);
}

export async function coauthors(guideId: string): Promise<{ id: string; name: string }[]> {
  return await query<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM guide_coauthors c JOIN users u ON u.id = c.user_id
     WHERE c.guide_id = $1 ORDER BY u.name`,
    [guideId],
  );
}

export async function mayEdit(guide: GuideRow, user: SessionUser | null): Promise<boolean> {
  if (user === null) return false;
  if (guide.owner_id === user.id) return true;
  return (await coauthorIds(guide.id)).includes(user.id);
}

export const isOwner = (guide: GuideRow, user: SessionUser | null): boolean =>
  user !== null && guide.owner_id === user.id;

/**
 * A private or draft guide answers 404 everywhere for everyone but its owner
 * and co-authors. A withdrawn guide is still seen, then answers 410.
 */
export async function maySee(guide: GuideRow, user: SessionUser | null): Promise<boolean> {
  if (await mayEdit(guide, user)) return true;
  if (guide.visibility === 'private') return false;
  return guide.state !== 'draft';
}

export async function likeCountOf(guideId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    'SELECT count(*)::text AS n FROM likes WHERE guide_id = $1',
    [guideId],
  );
  return Number(row?.n ?? '0');
}

export async function forkCountOf(guideId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    'SELECT count(*)::text AS n FROM guides WHERE forked_from_guide_id = $1',
    [guideId],
  );
  return Number(row?.n ?? '0');
}

export async function likedBy(guideId: string, userId: string | null): Promise<boolean> {
  if (userId === null) return false;
  const row = await queryOne<{ guide_id: string }>(
    'SELECT guide_id FROM likes WHERE guide_id = $1 AND user_id = $2',
    [guideId, userId],
  );
  return row !== null;
}

export const stepFromRow = (row: StepRow): Step => ({
  id: row.id,
  number: row.position,
  title: row.title,
  text: row.body_text,
  phase: row.phase,
  explode: Number(row.explode),
  focus_parts: row.focus_parts,
  camera: { yaw: row.yaw, pitch: row.pitch, zoom: Number(row.zoom) },
  callouts: row.callouts,
});

export const partFromRow = (row: PartRow): Part => ({
  id: row.id,
  name: row.name,
  node_path: row.node_path,
  unbound: row.node_path === null,
  axis: row.axis,
  apart_mm: Number(row.apart_mm),
  quantity: row.quantity,
  unit_price: Number(row.unit_price),
  fitted_at: row.fitted_at,
});

export const modelFromRow = (
  row: ModelRow | null,
  scale: number,
  scaleConfirmed: boolean,
): ModelRecord | null =>
  row === null
    ? null
    : {
        id: row.id,
        state: 'stored',
        bytes: Number(row.bytes),
        sha256: row.sha256,
        bbox_mm: [row.bbox_mm[0] ?? 0, row.bbox_mm[1] ?? 0, row.bbox_mm[2] ?? 0],
        scale,
        scale_confirmed: scaleConfirmed,
      };

export async function forkCredit(guide: GuideRow): Promise<ForkCredit | null> {
  if (guide.forked_from_guide_id === null) return null;
  return {
    guide_id: guide.forked_from_guide_id,
    title: guide.forked_from_title ?? '',
    author_name: guide.forked_from_author ?? '',
    version: guide.forked_from_version ?? 0,
  };
}

export interface VersionSnapshot {
  title: string;
  currency: Currency;
  tags: string[];
  model_id: string | null;
  model_scale: number;
  model_scale_confirmed: boolean;
  steps: Step[];
  parts: Part[];
}

export async function latestVersionNumber(guideId: string): Promise<number | null> {
  const row = await queryOne<{ number: number }>(
    'SELECT max(number) AS number FROM versions WHERE guide_id = $1',
    [guideId],
  );
  return row?.number ?? null;
}

export async function versionSnapshot(
  guideId: string,
  number: number,
): Promise<VersionSnapshot | null> {
  const row = await queryOne<{ snapshot: VersionSnapshot }>(
    'SELECT snapshot FROM versions WHERE guide_id = $1 AND number = $2',
    [guideId, number],
  );
  return row?.snapshot ?? null;
}

export async function workingSnapshot(guide: GuideRow): Promise<VersionSnapshot> {
  const [steps, parts] = await Promise.all([loadSteps(guide.id), loadParts(guide.id)]);
  return {
    title: guide.title,
    currency: guide.currency,
    tags: guide.tags,
    model_id: guide.model_id,
    model_scale: Number(guide.model_scale),
    model_scale_confirmed: guide.model_scale_confirmed,
    steps: steps.map(stepFromRow),
    parts: parts.map(partFromRow),
  };
}

export async function fieldRevisions(
  guideId: string,
  paths: readonly string[],
): Promise<Record<string, number>> {
  const rows = await query<{ field_path: string; revision: number }>(
    'SELECT field_path, revision FROM field_revisions WHERE guide_id = $1',
    [guideId],
  );
  const stored = new Map(rows.map((row) => [row.field_path, row.revision]));
  const out: Record<string, number> = {};
  for (const path of paths) out[path] = stored.get(path) ?? 0;
  return out;
}

export const GUIDE_FIELD_PATHS = [
  'title',
  'currency',
  'tags',
  'visibility',
  'model_scale',
  'model_scale_confirmed',
] as const;

export const STEP_FIELD_NAMES = [
  'title',
  'text',
  'phase',
  'explode',
  'focus_parts',
  'camera',
  'callouts',
] as const;

export const PART_FIELD_NAMES = [
  'name',
  'axis',
  'apart_mm',
  'quantity',
  'unit_price',
  'fitted_at',
  'node_path',
] as const;

export function allFieldPaths(snapshot: VersionSnapshot): string[] {
  const paths: string[] = [...GUIDE_FIELD_PATHS];
  for (const step of snapshot.steps) {
    for (const name of STEP_FIELD_NAMES) paths.push(`step/${step.id}/${name}`);
  }
  for (const part of snapshot.parts) {
    for (const name of PART_FIELD_NAMES) paths.push(`part/${part.id}/${name}`);
  }
  return paths;
}

export async function workingJson(guide: GuideRow): Promise<GuideWorking> {
  const snapshot = await workingSnapshot(guide);
  const [latest, revisions, model, credit] = await Promise.all([
    latestVersionNumber(guide.id),
    fieldRevisions(guide.id, allFieldPaths(snapshot)),
    loadModel(guide.model_id),
    forkCredit(guide),
  ]);
  const total = guideTotal(snapshot.parts, snapshot.steps);
  return {
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    state: guide.state,
    visibility: guide.visibility,
    currency: guide.currency,
    tags: guide.tags,
    revision: guide.revision,
    latest_version: latest,
    guide_total: total,
    guide_total_text: formatCost(total, guide.currency),
    field_revisions: revisions,
    model: modelFromRow(model, Number(guide.model_scale), guide.model_scale_confirmed),
    parts: snapshot.parts,
    steps: snapshot.steps,
    forked_from: credit,
  };
}

export function readerSteps(snapshot: VersionSnapshot): ReaderStep[] {
  return snapshot.steps.map((step) => {
    const cost = runningCost(snapshot.parts, snapshot.steps, step.number);
    return { ...step, parts_cost: cost, parts_cost_text: formatCost(cost, snapshot.currency) };
  });
}

/**
 * The guide reading JSON holds the published version; for an owner or
 * co-author of a guide with no published version it holds the latest saved
 * version, and otherwise the working copy.
 */
export async function readableSnapshot(
  guide: GuideRow,
  user: SessionUser | null,
): Promise<{ snapshot: VersionSnapshot; version: number | null } | null> {
  if (guide.published_version !== null) {
    const snapshot = await versionSnapshot(guide.id, guide.published_version);
    if (snapshot) return { snapshot, version: guide.published_version };
  }
  if (!(await mayEdit(guide, user))) return null;
  const latest = await latestVersionNumber(guide.id);
  if (latest !== null) {
    const snapshot = await versionSnapshot(guide.id, latest);
    if (snapshot) return { snapshot, version: latest };
  }
  return { snapshot: await workingSnapshot(guide), version: null };
}

export async function readingJson(
  guide: GuideRow,
  snapshot: VersionSnapshot,
): Promise<GuideReading> {
  const [author, likes, forks, credit] = await Promise.all([
    queryOne<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = $1', [
      guide.owner_id,
    ]),
    likeCountOf(guide.id),
    forkCountOf(guide.id),
    forkCredit(guide),
  ]);
  const steps = readerSteps(snapshot);
  const total = guideTotal(snapshot.parts, snapshot.steps);
  return {
    id: guide.id,
    slug: guide.slug,
    title: snapshot.title,
    author: { id: author?.id ?? guide.owner_id, name: author?.name ?? '' },
    state: guide.state,
    visibility: guide.visibility,
    currency: snapshot.currency,
    tags: snapshot.tags,
    published_version: guide.published_version,
    like_count: likes,
    fork_count: forks,
    model_id: snapshot.model_id,
    total_cost: total,
    total_cost_text: formatCost(total, snapshot.currency),
    part_count: snapshot.parts.length,
    step_count: snapshot.steps.length,
    parts: snapshot.parts,
    steps,
    forked_from: credit,
  };
}

const SLUG_MAX = 80;

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  return base.length > 0 ? base : 'guide';
}

export async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await queryOne<{ id: string }>('SELECT id FROM guides WHERE slug = $1', [
      candidate,
    ]);
    if (taken === null) return candidate;
  }
}

export async function createGuide(
  ownerId: string,
  title: string,
  currency: Currency,
  slug?: string,
): Promise<GuideRow> {
  const id = randomUUID();
  const rows = await query<GuideRow>(
    `INSERT INTO guides (id, slug, owner_id, title, currency)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${GUIDE_COLUMNS}`,
    [id, slug ?? (await uniqueSlug(title)), ownerId, title, currency],
  );
  const row = rows[0];
  if (!row) throw new Error('guide insert returned no row');
  return row;
}

export async function bumpRevision(guideId: string): Promise<number> {
  const row = await queryOne<{ revision: number }>(
    'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision',
    [guideId],
  );
  return row?.revision ?? 0;
}

export function searchTextOf(snapshot: VersionSnapshot): string {
  return [
    snapshot.title,
    ...snapshot.steps.map((step) => `${step.title} ${step.text}`),
    ...snapshot.parts.map((part) => part.name),
    ...snapshot.tags,
  ].join(' \n ');
}

export async function refreshSearchText(guide: GuideRow): Promise<void> {
  if (guide.published_version === null) {
    await execute('UPDATE guides SET search_text = $2 WHERE id = $1', [guide.id, '']);
    return;
  }
  const snapshot = await versionSnapshot(guide.id, guide.published_version);
  await execute('UPDATE guides SET search_text = $2 WHERE id = $1', [
    guide.id,
    snapshot ? searchTextOf(snapshot) : '',
  ]);
}
