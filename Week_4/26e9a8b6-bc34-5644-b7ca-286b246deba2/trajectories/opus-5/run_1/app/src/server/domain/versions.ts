import { query, queryOne, withTransaction } from '../db/index.js';
import { conflict, notFound } from '../http/errors.js';
import { formatCost, formatCostDifference, guideTotal } from '../../shared/cost.js';
import type { Part, Step } from '../../shared/types.js';
import {
  allFieldPaths,
  workingSnapshot,
  type GuideRow,
  type VersionSnapshot,
} from './guides.js';

export interface VersionListItem {
  number: number;
  saved_at: string;
  saved_by: string;
  restored_from: number | null;
  step_count: number;
  parts_cost: number;
  parts_cost_text: string;
}

/** The value of one field path within a snapshot, used to diff two versions. */
export function snapshotFieldValue(snapshot: VersionSnapshot, path: string): unknown {
  const segments = path.split('/');
  if (segments.length === 1) {
    switch (segments[0]) {
      case 'title':
        return snapshot.title;
      case 'currency':
        return snapshot.currency;
      case 'tags':
        return snapshot.tags;
      case 'model_scale':
        return snapshot.model_scale;
      case 'model_scale_confirmed':
        return snapshot.model_scale_confirmed;
      default:
        return undefined;
    }
  }
  const [kind, id, name] = segments;
  if (kind === 'step') {
    const step = snapshot.steps.find((candidate) => candidate.id === id);
    if (!step || name === undefined) return undefined;
    return name === 'text' ? step.text : (step as unknown as Record<string, unknown>)[name];
  }
  const part = snapshot.parts.find((candidate) => candidate.id === id);
  if (!part || name === undefined) return undefined;
  return (part as unknown as Record<string, unknown>)[name];
}

function differingFieldPaths(older: VersionSnapshot, newer: VersionSnapshot): string[] {
  const paths = new Set([...allFieldPaths(older), ...allFieldPaths(newer)]);
  const out: string[] = [];
  for (const path of paths) {
    const a = JSON.stringify(snapshotFieldValue(older, path) ?? null);
    const b = JSON.stringify(snapshotFieldValue(newer, path) ?? null);
    if (a !== b) out.push(path);
  }
  return out.sort();
}

export async function latestNumber(guideId: string): Promise<number | null> {
  const row = await queryOne<{ number: number | null }>(
    'SELECT max(number) AS number FROM versions WHERE guide_id = $1',
    [guideId],
  );
  return row?.number ?? null;
}

export interface SavedVersion {
  number: number;
}

/**
 * Saving a version stores steps, parts, bindings, phases and the model
 * reference as written. A base other than the latest writes nothing.
 */
export async function saveVersion(
  guide: GuideRow,
  baseVersion: number | null,
  savedBy: string,
  restoredFrom: number | null = null,
  snapshotOverride?: VersionSnapshot,
): Promise<SavedVersion> {
  const snapshot = snapshotOverride ?? (await workingSnapshot(guide));
  return await withTransaction(async (client) => {
    await client.query('SELECT id FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const current = await client.query<{ number: number | null }>(
      'SELECT max(number) AS number FROM versions WHERE guide_id = $1',
      [guide.id],
    );
    const latest = current.rows[0]?.number ?? null;
    if (restoredFrom === null && baseVersion !== latest) {
      const base = baseVersion === null ? null : await versionOf(guide.id, baseVersion);
      const fields = base === null ? [] : differingFieldPaths(base, snapshot);
      throw conflict({ error: 'version_conflict', current: latest, fields });
    }
    const next = (latest ?? 0) + 1;
    await client.query(
      `INSERT INTO versions (guide_id, number, saved_by, restored_from, base_version, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [guide.id, next, savedBy, restoredFrom, baseVersion, JSON.stringify(snapshot)],
    );
    return { number: next };
  });
}

async function versionOf(guideId: string, number: number): Promise<VersionSnapshot | null> {
  const row = await queryOne<{ snapshot: VersionSnapshot }>(
    'SELECT snapshot FROM versions WHERE guide_id = $1 AND number = $2',
    [guideId, number],
  );
  return row?.snapshot ?? null;
}

export interface VersionPage {
  items: VersionListItem[];
  next_cursor: string | null;
}

export async function listVersions(
  guide: GuideRow,
  cursor: string | null,
  limit: number,
): Promise<VersionPage> {
  const before = cursor === null ? null : Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  const rows = await query<{
    number: number;
    saved_at: Date;
    saved_by: string | null;
    restored_from: number | null;
    snapshot: VersionSnapshot;
  }>(
    `SELECT v.number, v.saved_at, u.name AS saved_by, v.restored_from, v.snapshot
     FROM versions v LEFT JOIN users u ON u.id = v.saved_by
     WHERE v.guide_id = $1 ${before === null ? '' : 'AND v.number < $3'}
     ORDER BY v.number DESC LIMIT $2`,
    before === null ? [guide.id, limit + 1] : [guide.id, limit + 1, before],
  );
  const page = rows.slice(0, limit);
  const items = page.map((row) => {
    const cost = guideTotal(row.snapshot.parts, row.snapshot.steps);
    return {
      number: row.number,
      saved_at: row.saved_at.toISOString(),
      saved_by: row.saved_by ?? '',
      restored_from: row.restored_from,
      step_count: row.snapshot.steps.length,
      parts_cost: cost,
      parts_cost_text: formatCost(cost, row.snapshot.currency),
    };
  });
  const last = page[page.length - 1];
  return {
    items,
    next_cursor:
      rows.length > limit && last
        ? Buffer.from(String(last.number), 'utf8').toString('base64url')
        : null,
  };
}

export interface VersionDetail {
  number: number;
  steps: Step[];
  parts: Part[];
  model_id: string | null;
  parts_cost: number;
  parts_cost_text: string;
}

export async function versionDetail(guideId: string, number: number): Promise<VersionDetail> {
  const snapshot = await versionOf(guideId, number);
  if (snapshot === null) throw notFound();
  const cost = guideTotal(snapshot.parts, snapshot.steps);
  return {
    number,
    steps: snapshot.steps,
    parts: snapshot.parts,
    model_id: snapshot.model_id,
    parts_cost: cost,
    parts_cost_text: formatCost(cost, snapshot.currency),
  };
}

/** Restore appends a new version equal to the chosen one and never rewrites history. */
export async function restoreVersion(
  guide: GuideRow,
  number: number,
  restoredBy: string,
): Promise<{ number: number; restored_from: number }> {
  const snapshot = await versionOf(guide.id, number);
  if (snapshot === null) throw notFound();
  await applySnapshotToWorkingCopy(guide, snapshot);
  const saved = await saveVersion(guide, null, restoredBy, number, snapshot);
  return { number: saved.number, restored_from: number };
}

/** Makes the working copy equal to the snapshot, bumping every field revision. */
export async function applySnapshotToWorkingCopy(
  guide: GuideRow,
  snapshot: VersionSnapshot,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE guides SET title = $2, currency = $3, tags = $4, model_id = $5,
         model_scale = $6, model_scale_confirmed = $7, revision = revision + 1
       WHERE id = $1`,
      [
        guide.id,
        snapshot.title,
        snapshot.currency,
        snapshot.tags,
        snapshot.model_id,
        snapshot.model_scale,
        snapshot.model_scale_confirmed,
      ],
    );
    await client.query('DELETE FROM steps WHERE guide_id = $1', [guide.id]);
    await client.query('DELETE FROM parts WHERE guide_id = $1', [guide.id]);
    for (const [index, part] of snapshot.parts.entries()) {
      await client.query(
        `INSERT INTO parts (id, guide_id, position, name, node_path, axis, apart_mm, quantity, unit_price, fitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          part.id,
          guide.id,
          index + 1,
          part.name,
          part.node_path,
          part.axis,
          part.apart_mm,
          part.quantity,
          part.unit_price,
          part.fitted_at,
        ],
      );
    }
    for (const step of snapshot.steps) {
      await client.query(
        `INSERT INTO steps (id, guide_id, position, title, body_text, phase, explode, focus_parts, yaw, pitch, zoom, callouts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          step.id,
          guide.id,
          step.number,
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
    }
    await client.query(
      `UPDATE field_revisions SET revision = revision + 1 WHERE guide_id = $1`,
      [guide.id],
    );
  });
}

export interface CompareJson {
  older: number;
  newer: number;
  added: { position: number; title: string }[];
  removed: { position: number; title: string }[];
  changed: { position: number; title: string; fields: string[] }[];
  moved: { title: string; from: number; to: number }[];
  part_changes: { part: string; field: string; from: unknown; to: unknown }[];
  cost_difference: number;
  cost_difference_text: string;
}

const STEP_COMPARE_FIELDS = ['title', 'text', 'phase', 'explode', 'focus_parts', 'camera', 'callouts'] as const;

function stepFieldsDiffer(a: Step, b: Step): string[] {
  const out: string[] = [];
  for (const field of STEP_COMPARE_FIELDS) {
    const left = JSON.stringify((a as unknown as Record<string, unknown>)[field] ?? null);
    const right = JSON.stringify((b as unknown as Record<string, unknown>)[field] ?? null);
    if (left !== right) out.push(field);
  }
  return out;
}

const PART_COMPARE_FIELDS = ['name', 'quantity', 'unit_price', 'fitted_at'] as const;

function stepTitleById(snapshot: VersionSnapshot, stepId: string | null): string | null {
  if (stepId === null) return null;
  return snapshot.steps.find((step) => step.id === stepId)?.title ?? null;
}

export function compareSnapshots(
  older: VersionSnapshot,
  newer: VersionSnapshot,
  olderNumber: number,
  newerNumber: number,
): CompareJson {
  const olderById = new Map(older.steps.map((step) => [step.id, step]));
  const newerById = new Map(newer.steps.map((step) => [step.id, step]));

  const added = newer.steps
    .filter((step) => !olderById.has(step.id))
    .map((step) => ({ position: step.number, title: step.title }));
  const removed = older.steps
    .filter((step) => !newerById.has(step.id))
    .map((step) => ({ position: step.number, title: step.title }));

  const changed: CompareJson['changed'] = [];
  for (const step of newer.steps) {
    const before = olderById.get(step.id);
    if (!before) continue;
    const fields = stepFieldsDiffer(before, step);
    if (fields.length > 0) changed.push({ position: step.number, title: step.title, fields });
  }

  const commonOlder = older.steps.filter((step) => newerById.has(step.id));
  const commonNewer = newer.steps.filter((step) => olderById.has(step.id));
  const moved: CompareJson['moved'] = [];
  commonNewer.forEach((step, index) => {
    if (commonOlder[index]?.id === step.id) return;
    const before = olderById.get(step.id);
    if (!before) return;
    moved.push({ title: step.title, from: before.number, to: step.number });
  });

  const olderParts = new Map(older.parts.map((part) => [part.id, part]));
  const part_changes: CompareJson['part_changes'] = [];
  for (const part of newer.parts) {
    const before = olderParts.get(part.id);
    if (!before) continue;
    for (const field of PART_COMPARE_FIELDS) {
      if (field === 'fitted_at') {
        const from = stepTitleById(older, before.fitted_at);
        const to = stepTitleById(newer, part.fitted_at);
        if (from !== to) part_changes.push({ part: part.name, field, from, to });
        continue;
      }
      const from = before[field];
      const to = part[field];
      if (from !== to) part_changes.push({ part: part.name, field, from, to });
    }
  }

  const difference =
    guideTotal(newer.parts, newer.steps) - guideTotal(older.parts, older.steps);
  return {
    older: olderNumber,
    newer: newerNumber,
    added,
    removed,
    changed,
    moved,
    part_changes,
    cost_difference: difference,
    cost_difference_text: formatCostDifference(difference, newer.currency),
  };
}

export async function compareVersions(
  guideId: string,
  olderNumber: number,
  newerNumber: number,
): Promise<CompareJson> {
  const [older, newer] = await Promise.all([
    versionOf(guideId, olderNumber),
    versionOf(guideId, newerNumber),
  ]);
  if (older === null || newer === null) throw notFound();
  return compareSnapshots(older, newer, olderNumber, newerNumber);
}
