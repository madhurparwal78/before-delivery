import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { compareEntities } from '../shared/derived.js';
import type { Entity, Pt, ResolvedEntity } from '../shared/geometry.js';
import type { DrawingModel } from '../shared/model.js';
import { SHEET_SIZES } from '../shared/model.js';
import { sheetSvg } from '../shared/svg.js';
import { loadDrawing, saveModel } from './ops.js';
import type { Storage } from './storage.js';
import { randomId, formatStamp, formatUtc } from '../shared/num.js';

export interface SheetRow {
  id: string;
  drawing_id: string;
  name: string;
  size: 'A3' | 'A4';
  number: number;
  locked: boolean;
  locked_by: string | null;
  created_by: string;
  attributes: Record<string, string>;
}

export interface ViewportRow {
  id: string;
  sheet_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: string;
  view_x: number;
  view_y: number;
  frozen_layers: string[];
}

export interface VersionRow {
  id: string;
  sheet_id: string;
  drawing_id: string;
  number: number;
  state: string;
  replaced_by: number | null;
  keys: string[] | null;
  snapshot: SheetSnapshot | null;
  published_at: string | null;
  created_by: string;
}

export interface SheetSnapshot {
  sheet: SheetRow & { viewports: ViewportRow[] };
  model: {
    layers: DrawingModel['layers'];
    entities: Record<string, ResolvedEntity>;
    order: string[];
    blocks: DrawingModel['blocks'];
    xrefs: DrawingModel['xrefs'];
  };
}

export async function sheetById(sheetId: string): Promise<SheetRow | null> {
  const result = await pool.query<SheetRow>(
    'SELECT id, drawing_id, name, size, number, locked, locked_by, created_by, attributes FROM sheets WHERE id = $1',
    [sheetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, attributes: row.attributes ?? {} };
}

export async function viewportsForSheet(sheetId: string): Promise<ViewportRow[]> {
  const result = await pool.query<ViewportRow>(
    'SELECT id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers FROM viewports WHERE sheet_id = $1 ORDER BY x, y',
    [sheetId],
  );
  return result.rows.map((row) => ({ ...row, frozen_layers: row.frozen_layers ?? [] }));
}

export async function versionById(versionId: string): Promise<VersionRow | null> {
  const result = await pool.query<VersionRow & { published_at: Date | null }>(
    'SELECT id, sheet_id, drawing_id, number, state, replaced_by, keys, snapshot, published_at, created_by FROM sheet_versions WHERE id = $1',
    [versionId],
  );
  return serialiseVersion(result.rows[0]);
}

export function serialiseVersion(row: (VersionRow & { published_at: Date | null }) | undefined): VersionRow | null {
  if (!row) return null;
  return {
    ...row,
    published_at: row.published_at ? formatUtc(row.published_at) : null,
  };
}

export async function versionsForSheet(sheetId: string): Promise<VersionRow[]> {
  const result = await pool.query<VersionRow & { published_at: Date | null }>(
    'SELECT id, sheet_id, drawing_id, number, state, replaced_by, keys, snapshot, published_at, created_by FROM sheet_versions WHERE sheet_id = $1 ORDER BY number ASC',
    [sheetId],
  );
  return result.rows.map(serialiseVersion).filter((v): v is VersionRow => v !== null);
}

export async function nextSheetNumber(drawingId: string): Promise<number> {
  const result = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM sheets WHERE drawing_id = $1', [drawingId]);
  return Number(result.rows[0]?.count ?? 0) + 1;
}

export interface PublishOutcome {
  version: VersionRow;
}

// Publish only confirms once MinIO holds both objects; otherwise the record is removed.
export async function publishVersion(sheetId: string, username: string, storage: Storage, now: Date): Promise<PublishOutcome> {
  const sheet = await sheetById(sheetId);
  if (!sheet) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
  const loaded = await loadDrawing(sheet.drawing_id);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  const existing = await pool.query<{ number: string }>('SELECT max(number)::text AS number FROM sheet_versions WHERE sheet_id = $1', [sheetId]);
  const number = Number(existing.rows[0]?.number ?? 0) + 1;
  const versionId = randomId('v');
  const viewports = await viewportsForSheet(sheetId);
  const model = loaded.engine.model;
  const resolved: Record<string, ResolvedEntity> = {};
  for (const handle of model.order) {
    const entity = model.entities[handle];
    if (!entity) continue;
    resolved[handle] = entity as ResolvedEntity;
  }
  const snapshot: SheetSnapshot = {
    sheet: { ...sheet, viewports },
    model: {
      layers: model.layers,
      entities: resolved,
      order: model.order,
      blocks: model.blocks,
      xrefs: model.xrefs,
    },
  };
  const size = SHEET_SIZES[sheet.size];
  const svg = sheetSvg(
    { layers: model.layers, entities: resolved, order: model.order, blocks: model.blocks, dimStyles: model.dim_styles },
    size.width,
    size.height,
  );
  const jsonKey = `versions/${sheetId}/${number}.json`;
  const svgKey = `versions/${sheetId}/${number}.svg`;
  try {
    await storage.put(jsonKey, Buffer.from(JSON.stringify({ sheet: snapshot.sheet, model: snapshot.model }), 'utf8'), 'application/json');
    await storage.put(svgKey, Buffer.from(svg, 'utf8'), 'image/svg+xml');
  } catch {
    throw new ApiError('storage_unavailable', ERROR_TEXT.storageDown);
  }
  await pool.query(
    'INSERT INTO sheet_versions (id, sheet_id, drawing_id, number, state, keys, snapshot, published_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [versionId, sheetId, sheet.drawing_id, number, 'published', JSON.stringify([jsonKey, svgKey]), JSON.stringify(snapshot), now, username],
  );
  await voidOlderVersions(sheetId, number, now);
  const version = await versionById(versionId);
  return { version: version as VersionRow };
}

export async function voidOlderVersions(sheetId: string, number: number, now: Date): Promise<void> {
  await pool.query(
    `UPDATE sheet_versions SET state = 'voided', replaced_by = $2 WHERE sheet_id = $1 AND number < $2 AND state IN ('published','in_review')`,
    [sheetId, number],
  );
}

export async function compareVersions(sheetId: string, fromNumber: number, toNumber: number): Promise<{ added: number; removed: number; changed: number; entities: Array<{ id: string; diff: string }> }> {
  const versions = await versionsForSheet(sheetId);
  const earlier = versions.find((v) => v.number === fromNumber);
  const later = versions.find((v) => v.number === toNumber);
  if (!earlier || !later) throw new ApiError('not_found', 'We couldn\u2019t find those versions.');
  return compareEntities(
    { entities: earlier.snapshot?.model.entities ?? {} },
    { entities: later.snapshot?.model.entities ?? {} },
  );
}

export async function stampsFor(versionId: string): Promise<Array<{ kind: string; username: string; at: string }>> {
  const result = await pool.query<{ kind: string; username: string; at: Date }>(
    'SELECT kind, username, at FROM version_stamps WHERE version_id = $1 ORDER BY at ASC',
    [versionId],
  );
  return result.rows.map((row) => ({ kind: row.kind, username: row.username, at: formatStamp(row.at) }));
}

export interface ReviewStepRow {
  step: 'markup' | 'manage';
  state: 'pending' | 'waiting' | 'approved' | 'rejected' | 'expired';
  due_at: string | null;
  acted_by: string | null;
  acted_at: string | null;
  comment: string | null;
}

export async function stepsFor(versionId: string): Promise<ReviewStepRow[]> {
  const result = await pool.query<{ step: string; state: string; due_at: Date | null; acted_by: string | null; acted_at: Date | null; comment: string | null }>(
    'SELECT step, state, due_at, acted_by, acted_at, comment FROM review_steps WHERE version_id = $1 ORDER BY step',
    [versionId],
  );
  return result.rows.map((row) => ({
    step: row.step as ReviewStepRow['step'],
    state: row.state as ReviewStepRow['state'],
    due_at: row.due_at ? formatUtc(row.due_at) : null,
    acted_by: row.acted_by,
    acted_at: row.acted_at ? formatUtc(row.acted_at) : null,
    comment: row.comment,
  }));
}
