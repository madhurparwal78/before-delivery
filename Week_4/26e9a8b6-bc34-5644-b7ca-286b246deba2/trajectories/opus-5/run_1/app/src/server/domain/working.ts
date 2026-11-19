import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { execute, queryOne, withTransaction } from '../db/index.js';
import { conflict, forbidden, invalid, tooLong, tooMany } from '../http/errors.js';
import { codePointLength } from '../../shared/limits.js';
import { CURRENCIES, PHASES, type Phase } from '../../shared/types.js';
import { QUANTITY_MAX, QUANTITY_MIN, UNIT_PRICE_MAX, UNIT_PRICE_MIN } from '../../shared/cost.js';
import {
  bumpRevision,
  loadParts,
  loadSteps,
  type GuideRow,
  type PartRow,
  type StepRow,
} from './guides.js';

export type FieldTarget =
  | { kind: 'guide'; name: string }
  | { kind: 'step'; id: string; name: string }
  | { kind: 'part'; id: string; name: string };

const GUIDE_FIELDS = new Set([
  'title',
  'currency',
  'tags',
  'visibility',
  'model_scale',
  'model_scale_confirmed',
]);
const STEP_FIELDS = new Set(['title', 'text', 'phase', 'explode', 'focus_parts', 'camera', 'callouts']);
const PART_FIELDS = new Set(['name', 'axis', 'apart_mm', 'quantity', 'unit_price', 'fitted_at', 'node_path']);

export function parseFieldPath(path: string): FieldTarget {
  const segments = path.split('/');
  if (segments.length === 1 && segments[0] !== undefined && GUIDE_FIELDS.has(segments[0])) {
    return { kind: 'guide', name: segments[0] };
  }
  if (segments.length === 3) {
    const [kind, id, name] = segments;
    if (kind === 'step' && id && name && STEP_FIELDS.has(name)) return { kind: 'step', id, name };
    if (kind === 'part' && id && name && PART_FIELDS.has(name)) return { kind: 'part', id, name };
  }
  throw invalid('field');
}

function asString(path: string, value: unknown): string {
  if (typeof value !== 'string') throw invalid(path);
  return value;
}

function asFiniteNumber(path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(path);
  return value;
}

function withinLength(path: string, text: string, limit: number): string {
  if (codePointLength(text) > limit) throw tooLong(path, limit);
  return text;
}

interface GuideShape {
  steps: StepRow[];
  parts: PartRow[];
}

async function shapeOf(guideId: string): Promise<GuideShape> {
  const [steps, parts] = await Promise.all([loadSteps(guideId), loadParts(guideId)]);
  return { steps, parts };
}

interface Applied {
  sql: string;
  params: readonly unknown[];
  /** The value stored, used for the live message and the conflict reply. */
  value: unknown;
}

async function modelNodePaths(modelId: string | null): Promise<string[]> {
  if (modelId === null) return [];
  const row = await queryOne<{ node_paths: string[] }>(
    'SELECT node_paths FROM models WHERE id = $1',
    [modelId],
  );
  return row?.node_paths ?? [];
}

async function planGuideField(
  guide: GuideRow,
  name: string,
  value: unknown,
  isGuideOwner: boolean,
): Promise<Applied> {
  switch (name) {
    case 'title': {
      const text = withinLength('title', asString('title', value), config.limits.guide_title_max);
      return { sql: 'UPDATE guides SET title = $2 WHERE id = $1', params: [guide.id, text], value: text };
    }
    case 'currency': {
      const text = asString('currency', value);
      if (!CURRENCIES.includes(text as (typeof CURRENCIES)[number])) throw invalid('currency');
      return { sql: 'UPDATE guides SET currency = $2 WHERE id = $1', params: [guide.id, text], value: text };
    }
    case 'tags': {
      if (!Array.isArray(value)) throw invalid('tags');
      if (value.length > config.limits.guide_tag_max) throw tooMany('tags', config.limits.guide_tag_max);
      const tags = value.map((tag) =>
        withinLength('tags', asString('tags', tag), config.limits.tag_text_max),
      );
      return { sql: 'UPDATE guides SET tags = $2 WHERE id = $1', params: [guide.id, tags], value: tags };
    }
    case 'visibility': {
      if (!isGuideOwner) throw forbidden();
      const text = asString('visibility', value);
      if (text !== 'public' && text !== 'private') throw invalid('visibility');
      return { sql: 'UPDATE guides SET visibility = $2 WHERE id = $1', params: [guide.id, text], value: text };
    }
    case 'model_scale': {
      const scale = asFiniteNumber('model_scale', value);
      if (scale <= 0) throw invalid('model_scale');
      return {
        sql: 'UPDATE guides SET model_scale = $2 WHERE id = $1',
        params: [guide.id, scale],
        value: scale,
      };
    }
    default: {
      if (typeof value !== 'boolean') throw invalid('model_scale_confirmed');
      return {
        sql: 'UPDATE guides SET model_scale_confirmed = $2 WHERE id = $1',
        params: [guide.id, value],
        value,
      };
    }
  }
}

function planStepField(
  path: string,
  step: StepRow,
  name: string,
  value: unknown,
  shape: GuideShape,
): Applied {
  const partIds = new Set(shape.parts.map((part) => part.id));
  switch (name) {
    case 'title': {
      const text = withinLength(path, asString(path, value), config.limits.step_title_max);
      return { sql: 'UPDATE steps SET title = $2 WHERE id = $1', params: [step.id, text], value: text };
    }
    case 'text': {
      const text = withinLength(path, asString(path, value), config.limits.step_text_max);
      return { sql: 'UPDATE steps SET body_text = $2 WHERE id = $1', params: [step.id, text], value: text };
    }
    case 'phase': {
      const text = asString(path, value);
      if (!PHASES.includes(text as Phase)) throw invalid(path);
      return { sql: 'UPDATE steps SET phase = $2 WHERE id = $1', params: [step.id, text], value: text };
    }
    case 'explode': {
      const amount = asFiniteNumber(path, value);
      if (amount < 0 || amount > 1) throw invalid(path);
      return { sql: 'UPDATE steps SET explode = $2 WHERE id = $1', params: [step.id, amount], value: amount };
    }
    case 'focus_parts': {
      if (!Array.isArray(value)) throw invalid(path);
      const ids = value.map((id) => asString(path, id));
      for (const id of ids) if (!partIds.has(id)) throw invalid(path);
      return {
        sql: 'UPDATE steps SET focus_parts = $2 WHERE id = $1',
        params: [step.id, ids],
        value: ids,
      };
    }
    case 'camera': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(path);
      const camera = value as Record<string, unknown>;
      const yaw = asFiniteNumber(path, camera['yaw']);
      const pitch = asFiniteNumber(path, camera['pitch']);
      const zoom = asFiniteNumber(path, camera['zoom']);
      if (!Number.isInteger(yaw) || yaw < -180 || yaw > 180) throw invalid(path);
      if (!Number.isInteger(pitch) || pitch < -60 || pitch > 60) throw invalid(path);
      if (zoom < 0.5 || zoom > 3) throw invalid(path);
      return {
        sql: 'UPDATE steps SET yaw = $2, pitch = $3, zoom = $4 WHERE id = $1',
        params: [step.id, yaw, pitch, zoom],
        value: { yaw, pitch, zoom },
      };
    }
    default: {
      if (!Array.isArray(value)) throw invalid(path);
      if (value.length > config.limits.step_callout_max) {
        throw tooMany(path, config.limits.step_callout_max);
      }
      const callouts = value.map((entry) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw invalid(path);
        const record = entry as Record<string, unknown>;
        const partId = asString(path, record['part_id']);
        if (!partIds.has(partId)) throw invalid(path);
        return {
          part_id: partId,
          text: withinLength(path, asString(path, record['text']), config.limits.callout_text_max),
        };
      });
      return {
        sql: 'UPDATE steps SET callouts = $2 WHERE id = $1',
        params: [step.id, JSON.stringify(callouts)],
        value: callouts,
      };
    }
  }
}

function planPartField(
  path: string,
  part: PartRow,
  name: string,
  value: unknown,
  shape: GuideShape,
  nodePaths: readonly string[],
): Applied {
  switch (name) {
    case 'name': {
      const text = withinLength(path, asString(path, value), config.limits.part_name_max);
      return { sql: 'UPDATE parts SET name = $2 WHERE id = $1', params: [part.id, text], value: text };
    }
    case 'axis': {
      const text = asString(path, value);
      if (text !== 'x' && text !== 'y' && text !== 'z') throw invalid(path);
      return { sql: 'UPDATE parts SET axis = $2 WHERE id = $1', params: [part.id, text], value: text };
    }
    case 'apart_mm': {
      const mm = asFiniteNumber(path, value);
      return { sql: 'UPDATE parts SET apart_mm = $2 WHERE id = $1', params: [part.id, mm], value: mm };
    }
    case 'quantity': {
      const quantity = asFiniteNumber(path, value);
      if (!Number.isInteger(quantity) || quantity < QUANTITY_MIN || quantity > QUANTITY_MAX) {
        throw invalid(path);
      }
      return {
        sql: 'UPDATE parts SET quantity = $2 WHERE id = $1',
        params: [part.id, quantity],
        value: quantity,
      };
    }
    case 'unit_price': {
      const price = asFiniteNumber(path, value);
      if (!Number.isInteger(price) || price < UNIT_PRICE_MIN || price > UNIT_PRICE_MAX) {
        throw invalid(path);
      }
      return {
        sql: 'UPDATE parts SET unit_price = $2 WHERE id = $1',
        params: [part.id, price],
        value: price,
      };
    }
    case 'fitted_at': {
      if (value === null) {
        return { sql: 'UPDATE parts SET fitted_at = NULL WHERE id = $1', params: [part.id], value: null };
      }
      const stepId = asString(path, value);
      if (!shape.steps.some((step) => step.id === stepId)) throw invalid(path);
      return {
        sql: 'UPDATE parts SET fitted_at = $2 WHERE id = $1',
        params: [part.id, stepId],
        value: stepId,
      };
    }
    default: {
      const nodePath = asString(path, value);
      if (!nodePaths.includes(nodePath)) throw invalid(path);
      return {
        sql: 'UPDATE parts SET node_path = $2 WHERE id = $1',
        params: [part.id, nodePath],
        value: nodePath,
      };
    }
  }
}

export interface CommitResult {
  revision: number;
  fieldRevision: number;
  value: unknown;
}

async function currentFieldValue(guide: GuideRow, target: FieldTarget): Promise<unknown> {
  const shape = await shapeOf(guide.id);
  if (target.kind === 'guide') {
    switch (target.name) {
      case 'title':
        return guide.title;
      case 'currency':
        return guide.currency;
      case 'tags':
        return guide.tags;
      case 'visibility':
        return guide.visibility;
      case 'model_scale':
        return Number(guide.model_scale);
      default:
        return guide.model_scale_confirmed;
    }
  }
  if (target.kind === 'step') {
    const step = shape.steps.find((row) => row.id === target.id);
    if (!step) return null;
    switch (target.name) {
      case 'title':
        return step.title;
      case 'text':
        return step.body_text;
      case 'phase':
        return step.phase;
      case 'explode':
        return Number(step.explode);
      case 'focus_parts':
        return step.focus_parts;
      case 'camera':
        return { yaw: step.yaw, pitch: step.pitch, zoom: Number(step.zoom) };
      default:
        return step.callouts;
    }
  }
  const part = shape.parts.find((row) => row.id === target.id);
  if (!part) return null;
  switch (target.name) {
    case 'name':
      return part.name;
    case 'axis':
      return part.axis;
    case 'apart_mm':
      return Number(part.apart_mm);
    case 'quantity':
      return part.quantity;
    case 'unit_price':
      return Number(part.unit_price);
    case 'fitted_at':
      return part.fitted_at;
    default:
      return part.node_path;
  }
}

/**
 * One commit is one field change carrying the field revision it was based on.
 * A stale `based_on` on the same field answers the edit conflict and the
 * stored value stays; of two commits on one field the first to reach the
 * database wins.
 */
export async function commitField(
  guide: GuideRow,
  fieldPath: string,
  value: unknown,
  basedOn: number,
  user: { id: string; name: string },
  isGuideOwner: boolean,
): Promise<CommitResult> {
  const target = parseFieldPath(fieldPath);
  const shape = await shapeOf(guide.id);

  let plan: Applied;
  if (target.kind === 'guide') {
    plan = await planGuideField(guide, target.name, value, isGuideOwner);
  } else if (target.kind === 'step') {
    const step = shape.steps.find((row) => row.id === target.id);
    if (!step) throw invalid('field');
    plan = planStepField(fieldPath, step, target.name, value, shape);
  } else {
    const part = shape.parts.find((row) => row.id === target.id);
    if (!part) throw invalid('field');
    plan = planPartField(
      fieldPath,
      part,
      target.name,
      value,
      shape,
      await modelNodePaths(guide.model_id),
    );
  }

  const won = await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO field_revisions (guide_id, field_path, revision) VALUES ($1, $2, 0)
       ON CONFLICT (guide_id, field_path) DO NOTHING`,
      [guide.id, fieldPath],
    );
    const bumped = await client.query<{ revision: number }>(
      `UPDATE field_revisions SET revision = revision + 1, updated_by = $3
       WHERE guide_id = $1 AND field_path = $2 AND revision = $4 RETURNING revision`,
      [guide.id, fieldPath, user.id, basedOn],
    );
    const row = bumped.rows[0];
    if (!row) return null;
    await client.query(plan.sql, plan.params as unknown[]);
    return row.revision;
  });

  if (won === null) {
    const stored = await queryOne<{ revision: number; name: string | null }>(
      `SELECT f.revision, u.name FROM field_revisions f
       LEFT JOIN users u ON u.id = f.updated_by
       WHERE f.guide_id = $1 AND f.field_path = $2`,
      [guide.id, fieldPath],
    );
    throw conflict({
      error: 'edit_conflict',
      field: fieldPath,
      yours: value,
      theirs: {
        value: await currentFieldValue(guide, target),
        revision: stored?.revision ?? 0,
        by: stored?.name ?? '',
      },
    });
  }

  return { revision: await bumpRevision(guide.id), fieldRevision: won, value: plan.value };
}

async function resetFieldRevisions(guideId: string, prefix: string): Promise<void> {
  await execute('DELETE FROM field_revisions WHERE guide_id = $1 AND field_path LIKE $2', [
    guideId,
    `${prefix}%`,
  ]);
}

export interface AddedStep {
  id: string;
  number: number;
  revision: number;
}

export async function addStep(
  guide: GuideRow,
  title: string,
  stepId?: string,
): Promise<AddedStep> {
  withinLength('step_title', title, config.limits.step_title_max);
  const steps = await loadSteps(guide.id);
  if (steps.length >= config.limits.guide_step_max) {
    throw tooMany('steps', config.limits.guide_step_max);
  }
  const id = stepId ?? randomUUID();
  const position = steps.length + 1;
  await execute(
    `INSERT INTO steps (id, guide_id, position, title, body_text, phase, explode, yaw, pitch, zoom)
     VALUES ($1, $2, $3, $4, '', 'open_up', 0, 30, 15, 1)`,
    [id, guide.id, position, title],
  );
  await resetFieldRevisions(guide.id, `step/${id}/`);
  return { id, number: position, revision: await bumpRevision(guide.id) };
}

interface RestorableStep {
  id: string;
  number: number;
  title: string;
  text: string;
  phase: Phase;
  explode: number;
  focus_parts: string[];
  camera: { yaw: number; pitch: number; zoom: number };
  callouts: { part_id: string; text: string }[];
}

function asRestorableStep(value: unknown): RestorableStep {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('restore');
  const record = value as Record<string, unknown>;
  const camera = record['camera'];
  if (typeof record['id'] !== 'string' || typeof record['number'] !== 'number') {
    throw invalid('restore');
  }
  if (typeof camera !== 'object' || camera === null) throw invalid('restore');
  const pose = camera as Record<string, unknown>;
  const phase = String(record['phase']);
  if (!PHASES.includes(phase as Phase)) throw invalid('restore');
  return {
    id: record['id'],
    number: record['number'],
    title: String(record['title'] ?? ''),
    text: String(record['text'] ?? ''),
    phase: phase as Phase,
    explode: Number(record['explode'] ?? 0),
    focus_parts: Array.isArray(record['focus_parts']) ? record['focus_parts'].map(String) : [],
    camera: {
      yaw: Number(pose['yaw'] ?? 30),
      pitch: Number(pose['pitch'] ?? 15),
      zoom: Number(pose['zoom'] ?? 1),
    },
    callouts: Array.isArray(record['callouts'])
      ? record['callouts'].map((entry) => {
          const callout = entry as Record<string, unknown>;
          return { part_id: String(callout['part_id']), text: String(callout['text'] ?? '') };
        })
      : [],
  };
}

/** Restores a deleted step with its id, as undoing a delete must. */
export async function restoreStep(guide: GuideRow, raw: unknown): Promise<AddedStep> {
  const step = asRestorableStep(raw);
  const existing = await loadSteps(guide.id);
  if (existing.length >= config.limits.guide_step_max) {
    throw tooMany('steps', config.limits.guide_step_max);
  }
  const position = Math.min(Math.max(step.number, 1), existing.length + 1);
  await execute('UPDATE steps SET position = position + 1 WHERE guide_id = $1 AND position >= $2', [
    guide.id,
    position,
  ]);
  await execute(
    `INSERT INTO steps (id, guide_id, position, title, body_text, phase, explode, focus_parts, yaw, pitch, zoom, callouts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      step.id,
      guide.id,
      position,
      step.title,
      step.text,
      step.phase,
      step.explode,
      step.focus_parts,
      step.camera.yaw,
      step.camera.pitch,
      step.camera.zoom,
      JSON.stringify(step.callouts),
    ],
  );
  await resetFieldRevisions(guide.id, `step/${step.id}/`);
  return { id: step.id, number: position, revision: await bumpRevision(guide.id) };
}

export async function deleteStep(guide: GuideRow, stepId: string): Promise<number> {
  const step = await queryOne<{ position: number }>(
    'SELECT position FROM steps WHERE id = $1 AND guide_id = $2',
    [stepId, guide.id],
  );
  if (!step) throw invalid('step');
  await execute('UPDATE parts SET fitted_at = NULL WHERE guide_id = $1 AND fitted_at = $2', [
    guide.id,
    stepId,
  ]);
  await execute('DELETE FROM steps WHERE id = $1', [stepId]);
  await execute('UPDATE steps SET position = position - 1 WHERE guide_id = $1 AND position > $2', [
    guide.id,
    step.position,
  ]);
  await resetFieldRevisions(guide.id, `step/${stepId}/`);
  return await bumpRevision(guide.id);
}

export async function moveStep(
  guide: GuideRow,
  stepId: string,
  position: number,
): Promise<{ revision: number; order: string[] }> {
  const steps = await loadSteps(guide.id);
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) throw invalid('step');
  if (!Number.isInteger(position) || position < 1 || position > steps.length) {
    throw invalid('position');
  }
  const order = steps.map((step) => step.id);
  const [moved] = order.splice(index, 1);
  if (moved === undefined) throw invalid('step');
  order.splice(position - 1, 0, moved);
  for (let i = 0; i < order.length; i += 1) {
    await execute('UPDATE steps SET position = $2 WHERE id = $1', [order[i], i + 1]);
  }
  return { revision: await bumpRevision(guide.id), order };
}

export async function deletePart(guide: GuideRow, partId: string): Promise<number> {
  const part = await queryOne<{ id: string }>('SELECT id FROM parts WHERE id = $1 AND guide_id = $2', [
    partId,
    guide.id,
  ]);
  if (!part) throw invalid('part');
  await execute(
    `UPDATE steps SET focus_parts = array_remove(focus_parts, $2::uuid),
       callouts = (SELECT coalesce(jsonb_agg(entry), '[]'::jsonb) FROM jsonb_array_elements(callouts) entry
                   WHERE entry->>'part_id' <> $2)
     WHERE guide_id = $1`,
    [guide.id, partId],
  );
  await execute('DELETE FROM parts WHERE id = $1', [partId]);
  await resetFieldRevisions(guide.id, `part/${partId}/`);
  return await bumpRevision(guide.id);
}
