import { one, type Db } from './db';
import type { Bounds } from '../shared/glb';
import { guideTotal, formatCost, runningCost } from '../shared/cost';
import type {
  Camera, Callout, Currency, ForkCredit, GuideReading, GuideState, Model, Part, Phase, Step, User, Visibility, Working,
} from '../shared/types';

export interface GuideRecord {
  id: string;
  slug: string;
  ownerId: string;
  ownerName: string;
  title: string;
  currency: Currency;
  tags: string[];
  visibility: Visibility;
  state: GuideState;
  publishedVersion: number | null;
  modelId: string | null;
  modelScale: number;
  modelScaleConfirmed: boolean;
  revision: number;
  forkedFrom: ForkCredit | null;
}

export interface Content {
  steps: Step[];
  parts: Part[];
  model_id: string | null;
  model_scale: number;
  model_scale_confirmed: boolean;
}

interface GuideRow {
  id: string; slug: string; owner_id: string; owner_name: string; title: string; currency: Currency; tags: string[];
  visibility: Visibility; state: GuideState; published_version: number | null; model_id: string | null; model_scale: number;
  model_scale_confirmed: boolean; revision: number; source_guide_id: string | null; source_title: string | null;
  source_author: string | null; source_version: number | null;
}

const guideColumns = `g.id, g.slug, g.owner_id, u.name AS owner_name, g.title, g.currency, g.tags, g.visibility, g.state,
  g.published_version, g.model_id, g.model_scale, g.model_scale_confirmed, g.revision, g.source_guide_id, g.source_title,
  g.source_author, g.source_version`;

function toRecord(row: GuideRow): GuideRecord {
  return {
    id: row.id, slug: row.slug, ownerId: row.owner_id, ownerName: row.owner_name, title: row.title, currency: row.currency,
    tags: row.tags, visibility: row.visibility, state: row.state, publishedVersion: row.published_version, modelId: row.model_id,
    modelScale: row.model_scale, modelScaleConfirmed: row.model_scale_confirmed, revision: row.revision,
    forkedFrom: row.source_title === null ? null : {
      guide_id: row.source_guide_id ?? '', title: row.source_title, author_name: row.source_author ?? '', version: row.source_version ?? 0,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (value: string) => UUID.test(value);

export async function guideById(db: Db, id: string): Promise<GuideRecord | null> {
  if (!isUuid(id)) return null;
  const row = await one<GuideRow>(db, `SELECT ${guideColumns} FROM guides g JOIN users u ON u.id = g.owner_id WHERE g.id = $1`, [id]);
  return row ? toRecord(row) : null;
}

export async function guideBySlug(db: Db, slug: string): Promise<GuideRecord | null> {
  const row = await one<GuideRow>(db, `SELECT ${guideColumns} FROM guides g JOIN users u ON u.id = g.owner_id WHERE g.slug = $1`, [slug]);
  return row ? toRecord(row) : null;
}

export type Role = 'owner' | 'coauthor' | 'none';

export async function roleOf(db: Db, guide: GuideRecord, user: User | null): Promise<Role> {
  if (!user) return 'none';
  if (guide.ownerId === user.id) return 'owner';
  const row = await one(db, 'SELECT 1 FROM coauthors WHERE guide_id = $1 AND user_id = $2', [guide.id, user.id]);
  return row ? 'coauthor' : 'none';
}

/** The one rule for who can see a guide at all: its team, or anyone once it is public and was ever published. */
export function visibleTo(guide: GuideRecord, role: Role): boolean {
  return role !== 'none' || (guide.visibility === 'public' && (guide.state === 'published' || guide.state === 'withdrawn'));
}

export function isMember(role: Role): boolean {
  return role !== 'none';
}

interface StepRow { id: string; title: string; text: string; phase: Phase; explode: number; focus_parts: string[]; camera: Camera; callouts: Callout[] }
interface PartRow {
  id: string; name: string; node_path: string; unbound: boolean; axis: Part['axis']; apart_mm: number; quantity: number;
  unit_price: number; fitted_at: string | null;
}

export async function loadWorking(db: Db, guide: GuideRecord): Promise<Content> {
  const steps = await db.query<StepRow>(
    'SELECT id, title, text, phase, explode, focus_parts, camera, callouts FROM steps WHERE guide_id = $1 ORDER BY position', [guide.id]);
  const parts = await db.query<PartRow>(
    'SELECT id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at FROM parts WHERE guide_id = $1 ORDER BY position', [guide.id]);
  return {
    steps: steps.rows.map((row, i) => ({ ...row, number: i + 1 })),
    parts: parts.rows,
    model_id: guide.modelId,
    model_scale: guide.modelScale,
    model_scale_confirmed: guide.modelScaleConfirmed,
  };
}

export async function loadSnapshot(db: Db, guideId: string, number: number): Promise<{ content: Content; savedBy: string; savedAt: Date; restoredFrom: number | null } | null> {
  if (!Number.isInteger(number) || number < 0 || number > 2_147_483_647) return null;
  const row = await one<{ snapshot: Content; saved_at: Date; restored_from: number | null; saved_by: string | null }>(
    db,
    `SELECT v.snapshot, v.saved_at, v.restored_from, u.name AS saved_by FROM versions v LEFT JOIN users u ON u.id = v.saved_by
      WHERE v.guide_id = $1 AND v.number = $2`,
    [guideId, number],
  );
  return row ? { content: row.snapshot, savedBy: row.saved_by ?? '', savedAt: row.saved_at, restoredFrom: row.restored_from } : null;
}

export async function latestVersion(db: Db, guideId: string): Promise<number | null> {
  const row = await one<{ latest: number | null }>(db, 'SELECT max(number) AS latest FROM versions WHERE guide_id = $1', [guideId]);
  return row?.latest ?? null;
}

export const contentCost = (content: Content) => guideTotal(content.parts, content.steps.map((s) => s.id));

async function modelOf(db: Db, content: Content): Promise<Model | null> {
  if (!content.model_id) return null;
  const row = await one<{ id: string; bytes: number; sha256: string; bounds: Bounds }>(
    db, 'SELECT id, bytes, sha256, bounds FROM models WHERE id = $1', [content.model_id]);
  if (!row) return null;
  const bbox = row.bounds.max.map((high, k) => Math.round((high - row.bounds.min[k]!) * 1000 * content.model_scale * 100) / 100) as [number, number, number];
  return { id: row.id, state: 'stored', bytes: row.bytes, sha256: row.sha256, bbox_mm: bbox, scale: content.model_scale, scale_confirmed: content.model_scale_confirmed };
}

async function fieldRevisions(db: Db, guideId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ field: string; revision: number }>('SELECT field, revision FROM field_revisions WHERE guide_id = $1', [guideId]);
  return Object.fromEntries(rows.rows.map((r) => [r.field, r.revision]));
}

export async function workingJson(db: Db, guide: GuideRecord): Promise<Working> {
  const content = await loadWorking(db, guide);
  const total = contentCost(content);
  return {
    id: guide.id, slug: guide.slug, title: guide.title, state: guide.state, visibility: guide.visibility, currency: guide.currency,
    tags: guide.tags, revision: guide.revision, latest_version: await latestVersion(db, guide.id), guide_total: total,
    guide_total_text: formatCost(total, guide.currency), field_revisions: await fieldRevisions(db, guide.id),
    model: await modelOf(db, content), parts: content.parts, steps: content.steps, forked_from: guide.forkedFrom,
    coauthors: (await db.query<{ id: string; name: string }>('SELECT u.id, u.name FROM coauthors c JOIN users u ON u.id = c.user_id WHERE c.guide_id = $1 ORDER BY u.name', [guide.id])).rows,
  };
}

export async function countsOf(db: Db, guideId: string): Promise<{ like_count: number; fork_count: number }> {
  const row = await one<{ likes: string; forks: string }>(
    db,
    `SELECT (SELECT count(*) FROM likes WHERE guide_id = $1) AS likes, (SELECT count(*) FROM guides WHERE source_guide_id = $1) AS forks`,
    [guideId],
  );
  return { like_count: Number(row?.likes ?? 0), fork_count: Number(row?.forks ?? 0) };
}

/** The content a reader sees: the published version, or for the team of an unpublished guide the latest saved one. */
export async function readingContent(db: Db, guide: GuideRecord): Promise<Content | null> {
  const number = guide.publishedVersion ?? (await latestVersion(db, guide.id));
  if (number === null) return null;
  return (await loadSnapshot(db, guide.id, number))?.content ?? null;
}

export async function forkSource(db: Db, guide: GuideRecord, viewerRole: (g: GuideRecord) => Promise<Role>): Promise<string | null> {
  if (!guide.forkedFrom?.guide_id) return null;
  const source = await guideById(db, guide.forkedFrom.guide_id);
  if (!source || source.state !== 'published' || !visibleTo(source, await viewerRole(source))) return null;
  return source.slug;
}

export async function readingJson(
  db: Db, guide: GuideRecord, content: Content, liked: boolean, sourceSlug: string | null,
): Promise<GuideReading & { fork_source_slug: string | null }> {
  const ids = content.steps.map((s) => s.id);
  const total = guideTotal(content.parts, ids);
  const steps = content.steps.map((step, i) => {
    const cost = runningCost(content.parts, ids, i + 1);
    return { ...step, parts_cost: cost, parts_cost_text: formatCost(cost, guide.currency) };
  });
  return {
    id: guide.id, slug: guide.slug, title: guide.title, author: { id: guide.ownerId, name: guide.ownerName }, state: guide.state,
    visibility: guide.visibility, currency: guide.currency, tags: guide.tags, published_version: guide.publishedVersion,
    ...(await countsOf(db, guide.id)), model_id: content.model_id, model_scale: content.model_scale, total_cost: total,
    total_cost_text: formatCost(total, guide.currency), part_count: content.parts.length, step_count: content.steps.length,
    parts: content.parts, steps, forked_from: guide.forkedFrom, liked, fork_source_slug: sourceSlug,
  };
}


/** Writes a content snapshot into the guide's part and step rows, in order. */
export async function insertContent(db: Db, guideId: string, content: Content): Promise<void> {
  for (const [i, part] of content.parts.entries())
    await db.query(
      `INSERT INTO parts (id, guide_id, position, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [part.id, guideId, i + 1, part.name, part.node_path, part.unbound, part.axis, part.apart_mm, part.quantity, part.unit_price, part.fitted_at]);
  for (const [i, step] of content.steps.entries())
    await db.query(
      `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera, callouts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [step.id, guideId, i + 1, step.title, step.text, step.phase, step.explode, JSON.stringify(step.focus_parts), JSON.stringify(step.camera), JSON.stringify(step.callouts)]);
}
