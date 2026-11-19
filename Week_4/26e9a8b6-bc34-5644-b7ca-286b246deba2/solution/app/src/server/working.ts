import { randomUUID } from 'node:crypto';
import { limits } from './config';
import { guideAccess } from './access';
import { one, pool, transaction, type Db } from './db';
import { conflict, forbidden, invalid, notFound, tooLong, tooMany } from './errors';
import type { Ctx } from './http';
import { emitGuide } from './live';
import { contentCost, guideById, isUuid, loadWorking, workingJson, type GuideRecord } from './content';
import { refreshSearchText } from './search';
import { formatCost } from '../shared/cost';
import { codePointLength } from '../shared/text';
import { AXES, CURRENCIES, PHASES, VISIBILITIES, type Callout, type Camera, type Phase } from '../shared/types';

const phases = PHASES;
const currencies = CURRENCIES;
const visibilities = VISIBILITIES;
const axes = AXES;

const guideFields = ['title', 'currency', 'tags', 'visibility', 'model_scale', 'model_scale_confirmed'];
const stepFields = ['title', 'text', 'phase', 'explode', 'focus_parts', 'camera', 'callouts'];
const partFields = ['name', 'axis', 'apart_mm', 'quantity', 'unit_price', 'fitted_at', 'node_path'];

/** Makes the field-revision rows match the steps and parts that exist: new paths start at 0, vanished ones go. */
export async function syncFieldPaths(db: Db, guideId: string): Promise<void> {
  const steps = await db.query<{ id: string }>('SELECT id FROM steps WHERE guide_id = $1', [guideId]);
  const parts = await db.query<{ id: string }>('SELECT id FROM parts WHERE guide_id = $1', [guideId]);
  const paths = [
    ...guideFields,
    ...steps.rows.flatMap((s) => stepFields.map((f) => `step/${s.id}/${f}`)),
    ...parts.rows.flatMap((p) => partFields.map((f) => `part/${p.id}/${f}`)),
  ];
  await db.query(
    'INSERT INTO field_revisions (guide_id, field) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [guideId, paths]);
  await db.query('DELETE FROM field_revisions WHERE guide_id = $1 AND NOT (field = ANY($2::text[]))', [guideId, paths]);
}

type Target = { kind: 'guide'; name: string } | { kind: 'step' | 'part'; id: string; name: string };

function parseField(field: unknown): Target {
  if (typeof field !== 'string') throw invalid('field');
  const [first, id, name, extra] = field.split('/');
  if (extra === undefined && id === undefined && guideFields.includes(first ?? '')) return { kind: 'guide', name: first! };
  if (extra === undefined && id !== undefined && name !== undefined && isUuid(id)) {
    if (first === 'step' && stepFields.includes(name)) return { kind: 'step', id, name };
    if (first === 'part' && partFields.includes(name)) return { kind: 'part', id, name };
  }
  throw invalid('field');
}

function text(value: unknown, field: string, max: number, min = 0): string {
  if (typeof value !== 'string') throw invalid(field);
  const length = codePointLength(value);
  if (length > max) throw tooLong(field, max);
  if (length < min) throw invalid(field);
  return value;
}

function choice<T extends string>(value: unknown, list: readonly T[], field: string): T {
  if (!list.includes(value as T)) throw invalid(field);
  return value as T;
}

function number(value: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw invalid(field);
  return value;
}

function validCamera(value: unknown, field: string): Camera {
  const camera = value as Partial<Camera> | null;
  if (camera === null || typeof camera !== 'object') throw invalid(field);
  return {
    yaw: number(camera.yaw, field, -180, 180, true),
    pitch: number(camera.pitch, field, -60, 60, true),
    zoom: number(camera.zoom, field, 0.5, 3),
  };
}

async function partIdsOf(db: Db, guideId: string): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>('SELECT id FROM parts WHERE guide_id = $1', [guideId]);
  return new Set(rows.rows.map((r) => r.id));
}

async function stepIdsOf(db: Db, guideId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>('SELECT id FROM steps WHERE guide_id = $1 ORDER BY position', [guideId]);
  return rows.rows.map((r) => r.id);
}

async function validFocusParts(db: Db, guideId: string, value: unknown, field: string): Promise<string[]> {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw invalid(field);
  const known = await partIdsOf(db, guideId);
  if (value.some((id: string) => !known.has(id)) || new Set(value).size !== value.length) throw invalid(field);
  return value as string[];
}

async function validCallouts(db: Db, guideId: string, value: unknown, field: string): Promise<Callout[]> {
  if (!Array.isArray(value)) throw invalid(field);
  if (value.length > limits.step_callout_max) throw tooMany(field, limits.step_callout_max);
  const known = await partIdsOf(db, guideId);
  return value.map((entry: { part_id?: unknown; text?: unknown }) => {
    if (entry === null || typeof entry !== 'object' || typeof entry.part_id !== 'string' || !known.has(entry.part_id)) throw invalid(field);
    return { part_id: entry.part_id, text: text(entry.text, field, limits.callout_text_max) };
  });
}

function validTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw invalid('tags');
  if (value.length > limits.guide_tag_max) throw tooMany('tags', limits.guide_tag_max);
  return value.map((tag: string) => {
    const trimmed = tag.trim();
    if (trimmed === '') throw invalid('tags');
    return text(trimmed, 'tags', limits.tag_text_max);
  });
}

async function currentValue(db: Db, guideId: string, target: Target): Promise<unknown> {
  if (target.kind === 'guide') {
    const row = await one<Record<string, unknown>>(
      db, 'SELECT title, currency, tags, visibility, model_scale, model_scale_confirmed FROM guides WHERE id = $1', [guideId]);
    return row?.[target.name];
  }
  const table = target.kind === 'step' ? 'steps' : 'parts';
  const row = await one<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = $1 AND guide_id = $2`, [target.id, guideId]);
  if (!row) throw notFound();
  return row[target.name];
}

async function applyField(db: Db, guide: GuideRecord, target: Target, field: string, value: unknown): Promise<unknown> {
  const set = async (table: string, column: string, stored: unknown, id: string) => {
    await db.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [column === 'tags' || column === 'focus_parts' || column === 'camera' || column === 'callouts' ? JSON.stringify(stored) : stored, id]);
    return stored;
  };
  if (target.kind === 'guide') {
    let stored: unknown;
    switch (target.name) {
      case 'title': stored = text(value, field, limits.guide_title_max, 1); break;
      case 'currency': stored = choice(value, currencies, field); break;
      case 'tags': stored = validTags(value); break;
      case 'visibility': stored = choice(value, visibilities, field); break;
      case 'model_scale': stored = number(value, field, 1e-9, 1e9); break;
      default:
        if (typeof value !== 'boolean') throw invalid(field);
        stored = value;
    }
    await db.query(`UPDATE guides SET ${target.name} = $1 WHERE id = $2`, [target.name === 'tags' ? JSON.stringify(stored) : stored, guide.id]);
    return stored;
  }
  if (target.kind === 'step') {
    switch (target.name) {
      case 'title': return set('steps', 'title', text(value, field, limits.step_title_max), target.id);
      case 'text': return set('steps', 'text', text(value, field, limits.step_text_max), target.id);
      case 'phase': return set('steps', 'phase', choice(value, phases, field), target.id);
      case 'explode': return set('steps', 'explode', number(value, field, 0, 1), target.id);
      case 'focus_parts': return set('steps', 'focus_parts', await validFocusParts(db, guide.id, value, field), target.id);
      case 'camera': return set('steps', 'camera', validCamera(value, field), target.id);
      default: return set('steps', 'callouts', await validCallouts(db, guide.id, value, field), target.id);
    }
  }
  switch (target.name) {
    case 'name': return set('parts', 'name', text(value, field, limits.part_name_max, 1), target.id);
    case 'axis': return set('parts', 'axis', choice(value, axes, field), target.id);
    case 'apart_mm': return set('parts', 'apart_mm', number(value, field, -1e6, 1e6), target.id);
    case 'quantity': return set('parts', 'quantity', number(value, field, 1, 999, true), target.id);
    case 'unit_price': return set('parts', 'unit_price', number(value, field, 0, 99_999_999, true), target.id);
    case 'fitted_at': {
      if (value !== null && (typeof value !== 'string' || !(await stepIdsOf(db, guide.id)).includes(value))) throw invalid(field);
      return set('parts', 'fitted_at', value, target.id);
    }
    default: {
      const model = guide.modelId ? await one<{ nodes: { nodePath: string }[] }>(db, 'SELECT nodes FROM models WHERE id = $1', [guide.modelId]) : undefined;
      if (typeof value !== 'string' || !model?.nodes.some((n) => n.nodePath === value)) throw invalid(field);
      await db.query('UPDATE parts SET unbound = false WHERE id = $1', [target.id]);
      return set('parts', 'node_path', value, target.id);
    }
  }
}

export async function commitField(ctx: Ctx): Promise<unknown> {
  const { guide, role } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const user = ctx.user!;
  const body = await ctx.json();
  const target = parseField(body.field);
  if (target.kind === 'guide' && target.name === 'visibility' && role !== 'owner') throw forbidden();
  const field = body.field as string;
  const basedOn = body.based_on;
  if (!Number.isInteger(basedOn)) throw invalid('based_on');
  const result = await transaction(async (db) => {
    const row = await one<{ revision: number }>(db, 'SELECT revision FROM field_revisions WHERE guide_id = $1 AND field = $2 FOR UPDATE', [guide.id, field]);
    if (!row) throw notFound();
    if (row.revision !== basedOn) {
      const theirs = await one<{ by: string | null }>(db, 'SELECT u.name AS by FROM field_revisions f LEFT JOIN users u ON u.id = f.by_user_id WHERE f.guide_id = $1 AND f.field = $2', [guide.id, field]);
      throw conflict('edit_conflict', {
        field, yours: body.value, theirs: { value: await currentValue(db, guide.id, target), revision: row.revision, by: theirs?.by ?? '' },
      });
    }
    const fresh = (await guideById(db, guide.id))!;
    const stored = await applyField(db, fresh, target, field, body.value);
    await db.query('UPDATE field_revisions SET revision = revision + 1, by_user_id = $3 WHERE guide_id = $1 AND field = $2', [guide.id, field, user.id]);
    const revision = (await one<{ revision: number }>(db, 'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guide.id]))!.revision;
    if (target.kind === 'guide' && (target.name === 'title' || target.name === 'tags')) await refreshSearchText(db, guide.id);
    const content = await loadWorking(db, (await guideById(db, guide.id))!);
    const total = contentCost(content);
    return { stored, revision, field_revision: basedOn + 1, total, currency: (await guideById(db, guide.id))!.currency };
  });
  const text = formatCost(result.total, result.currency);
  emitGuide(guide.id, {
    type: 'field', field, value: result.stored, field_revision: result.field_revision, revision: result.revision,
    by: { id: user.id, name: user.name }, guide_total: result.total, guide_total_text: text,
  });
  return { revision: result.revision, field_revision: result.field_revision, guide_total: result.total, guide_total_text: text };
}

export async function readWorking(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member' });
  return workingJson(pool, guide);
}

interface StepInput { id?: unknown; position?: unknown; title?: unknown; text?: unknown; phase?: unknown; explode?: unknown; focus_parts?: unknown; camera?: unknown; callouts?: unknown }

export async function addStep(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const body = (await ctx.json()) as StepInput;
  const created = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const existing = await stepIdsOf(db, guide.id);
    if (existing.length >= limits.guide_step_max) throw tooMany('steps', limits.guide_step_max);
    const id = body.id === undefined ? randomUUID() : String(body.id);
    if (!isUuid(id) || existing.includes(id)) throw invalid('id');
    const title = text(body.title ?? '', 'title', limits.step_title_max);
    const position = body.position === undefined ? existing.length + 1 : number(body.position, 'position', 1, existing.length + 1, true);
    const previous = existing.length ? await one<{ camera: Camera; phase: Phase }>(db, 'SELECT camera, phase FROM steps WHERE id = $1', [existing[existing.length - 1]]) : undefined;
    const phase = body.phase === undefined ? previous?.phase ?? 'open_up' : choice(body.phase, phases, 'phase');
    const camera = body.camera === undefined ? previous?.camera ?? { yaw: 30, pitch: 15, zoom: 1 } : validCamera(body.camera, 'camera');
    await db.query('UPDATE steps SET position = position + 1 WHERE guide_id = $1 AND position >= $2', [guide.id, position]);
    await db.query(
      `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera, callouts) VALUES ($1,$2,$3,$4,$5,$6,$7,'[]',$8,'[]')`,
      [id, guide.id, position, title, text(body.text ?? '', 'text', limits.step_text_max), phase, body.explode === undefined ? 0 : number(body.explode, 'explode', 0, 1), JSON.stringify(camera)],
    );
    if (body.focus_parts !== undefined) await db.query('UPDATE steps SET focus_parts = $1 WHERE id = $2', [JSON.stringify(await validFocusParts(db, guide.id, body.focus_parts, 'focus_parts')), id]);
    if (body.callouts !== undefined) await db.query('UPDATE steps SET callouts = $1 WHERE id = $2', [JSON.stringify(await validCallouts(db, guide.id, body.callouts, 'callouts')), id]);
    await syncFieldPaths(db, guide.id);
    const revision = (await one<{ revision: number }>(db, 'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guide.id]))!.revision;
    return { id, number: position, revision };
  });
  emitGuide(guide.id, { type: 'working' });
  return created;
}

export async function deleteStep(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const revision = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const removed = await one<{ position: number }>(db, 'DELETE FROM steps WHERE id = $1 AND guide_id = $2 RETURNING position', [ctx.params.stepId, guide.id]);
    if (!removed) throw notFound();
    await db.query('UPDATE steps SET position = position - 1 WHERE guide_id = $1 AND position > $2', [guide.id, removed.position]);
    const unfitted = await db.query<{ id: string }>('UPDATE parts SET fitted_at = NULL WHERE guide_id = $1 AND fitted_at = $2 RETURNING id', [guide.id, ctx.params.stepId]);
    await syncFieldPaths(db, guide.id);
    for (const part of unfitted.rows) await db.query('UPDATE field_revisions SET revision = revision + 1 WHERE guide_id = $1 AND field = $2', [guide.id, `part/${part.id}/fitted_at`]);
    return (await one<{ revision: number }>(db, 'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guide.id]))!.revision;
  });
  emitGuide(guide.id, { type: 'working' });
  return { revision };
}

export async function moveStep(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const body = await ctx.json();
  const result = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const order = await stepIdsOf(db, guide.id);
    const from = order.indexOf(ctx.params.stepId!);
    if (from < 0) throw notFound();
    const to = number(body.position, 'position', 1, order.length, true) - 1;
    order.splice(to, 0, ...order.splice(from, 1));
    for (const [i, id] of order.entries()) await db.query('UPDATE steps SET position = $1 WHERE id = $2', [i + 1, id]);
    const revision = (await one<{ revision: number }>(db, 'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guide.id]))!.revision;
    return { revision, order };
  });
  emitGuide(guide.id, { type: 'working' });
  return result;
}

export async function deletePart(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const revision = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const removed = await one(db, 'DELETE FROM parts WHERE id = $1 AND guide_id = $2 RETURNING id', [ctx.params.partId, guide.id]);
    if (!removed) throw notFound();
    const steps = await db.query<{ id: string; focus_parts: string[]; callouts: Callout[] }>('SELECT id, focus_parts, callouts FROM steps WHERE guide_id = $1', [guide.id]);
    for (const step of steps.rows) {
      const focus = step.focus_parts.filter((p) => p !== ctx.params.partId);
      const callouts = step.callouts.filter((c) => c.part_id !== ctx.params.partId);
      if (focus.length !== step.focus_parts.length || callouts.length !== step.callouts.length)
        await db.query('UPDATE steps SET focus_parts = $1, callouts = $2 WHERE id = $3', [JSON.stringify(focus), JSON.stringify(callouts), step.id]);
    }
    await syncFieldPaths(db, guide.id);
    return (await one<{ revision: number }>(db, 'UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guide.id]))!.revision;
  });
  emitGuide(guide.id, { type: 'working' });
  return { revision };
}

export async function addCoauthor(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'owner', confirmed: true });
  const { email } = await ctx.json();
  if (typeof email !== 'string') throw invalid('email');
  const person = await one<{ id: string; name: string }>(pool, 'SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!person) throw notFound();
  if (person.id !== guide.ownerId) await pool.query('INSERT INTO coauthors (guide_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guide.id, person.id]);
  return person;
}

export async function removeCoauthor(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'owner', confirmed: true });
  await pool.query('DELETE FROM coauthors WHERE guide_id = $1 AND user_id = $2', [guide.id, ctx.params.userId]);
  return undefined;
}

