import { ApiError, MESSAGES } from '../shared/errors.js';
import { compareSnapshots, markupNeedsFlag, GEOMETRY_CHANGED_FLAG } from '../shared/compare.js';
import type { SheetSnapshot, VersionSnapshot, ViewportSnapshot } from '../shared/snapshot.js';
import { sheetSvg } from '../shared/svgtext.js';
import { type VersionState, replacedByText } from '../shared/transitions.js';
import { type DrawingState, broadcast, cachedDrawings, loadDrawing, resolveXrefs } from './drawings.js';
import { one, query } from './db.js';
import { newId } from './ids.js';
import { putObject, StorageUnavailable } from './storage.js';

export interface SheetRow {
  id: string;
  drawing_id: string;
  name: string;
  size: 'A3' | 'A4';
  number: number;
  locked: boolean;
  locked_by: string | null;
  attributes: Record<string, string>;
  creator: string;
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
  number: number;
  state: VersionState;
  replaced_by: number | null;
  snapshot: VersionSnapshot;
  keys: string[];
}

export async function sheetById(id: string): Promise<SheetRow | null> {
  return one<SheetRow>(
    'select id, drawing_id, name, size, number, locked, locked_by, attributes, creator from sheets where id = $1',
    [id],
  );
}

export async function sheetsOfDrawing(drawingId: string): Promise<SheetRow[]> {
  return query<SheetRow>(
    'select id, drawing_id, name, size, number, locked, locked_by, attributes, creator from sheets where drawing_id = $1 order by number',
    [drawingId],
  );
}

export async function viewportsOfSheet(sheetId: string): Promise<ViewportRow[]> {
  return query<ViewportRow>(
    'select id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers from viewports where sheet_id = $1 order by created_at',
    [sheetId],
  );
}

export async function versionById(id: string): Promise<VersionRow | null> {
  return one<VersionRow>('select id, sheet_id, number, state, replaced_by, snapshot, keys from versions where id = $1', [id]);
}

export async function versionsOfSheet(sheetId: string): Promise<VersionRow[]> {
  return query<VersionRow>(
    'select id, sheet_id, number, state, replaced_by, snapshot, keys from versions where sheet_id = $1 order by number',
    [sheetId],
  );
}

export function viewportSnapshot(viewport: ViewportRow): ViewportSnapshot {
  return {
    id: viewport.id,
    x: Number(viewport.x),
    y: Number(viewport.y),
    width: Number(viewport.width),
    height: Number(viewport.height),
    scale: viewport.scale,
    view_x: Number(viewport.view_x),
    view_y: Number(viewport.view_y),
    frozen_layers: viewport.frozen_layers,
  };
}

export async function sheetSnapshot(sheet: SheetRow): Promise<SheetSnapshot> {
  const viewports = await viewportsOfSheet(sheet.id);
  return {
    id: sheet.id,
    name: sheet.name,
    size: sheet.size,
    number: sheet.number,
    attributes: sheet.attributes,
    viewports: viewports.map(viewportSnapshot),
    creator: sheet.creator,
  };
}

export async function buildSnapshot(state: DrawingState, sheet: SheetRow): Promise<VersionSnapshot> {
  return {
    sheet: await sheetSnapshot(sheet),
    model: {
      layers: structuredClone(state.model.layers),
      entities: structuredClone(state.model.entities),
      blocks: structuredClone(state.model.blocks),
      xrefs: await resolveXrefs(state),
    },
  };
}

export function versionKeys(sheetId: string, number: number): string[] {
  return [`versions/${sheetId}/${number}.json`, `versions/${sheetId}/${number}.svg`];
}

export async function stampsOf(versionId: string): Promise<string[]> {
  const rows = await query<{ text: string }>('select text from version_stamps where version_id = $1 order by at', [versionId]);
  return rows.map((row) => row.text);
}

export async function versionPayload(version: VersionRow): Promise<Record<string, unknown>> {
  const sheet = await sheetById(version.sheet_id);
  return {
    id: version.id,
    sheet_id: version.sheet_id,
    drawing_id: sheet ? sheet.drawing_id : null,
    number: version.number,
    state: version.state,
    replaced_by: version.replaced_by,
    replaced_text: version.replaced_by === null ? null : replacedByText(version.replaced_by),
    stamps: await stampsOf(version.id),
    snapshot: version.snapshot,
  };
}

async function carryMarkups(previous: VersionRow | null, next: VersionRow): Promise<void> {
  if (!previous) return;
  const markups = await query<{
    id: string;
    kind: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    text: string | null;
    author: string;
  }>('select id, kind, x1, y1, x2, y2, text, author from markups where version_id = $1 order by created_at', [previous.id]);
  for (const markup of markups) {
    const flag = markupNeedsFlag(previous.snapshot, next.snapshot, {
      x1: Number(markup.x1),
      y1: Number(markup.y1),
      x2: Number(markup.x2),
      y2: Number(markup.y2),
    })
      ? GEOMETRY_CHANGED_FLAG
      : null;
    await query(
      'insert into markups (id, version_id, kind, x1, y1, x2, y2, text, flag, author) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [newId('mk'), next.id, markup.kind, markup.x1, markup.y1, markup.x2, markup.y2, markup.text, flag, markup.author],
    );
  }
}

async function voidOlderVersions(sheetId: string, newNumber: number, newVersionId: string): Promise<void> {
  const others = await query<{ id: string; state: VersionState; number: number }>(
    "select id, state, number from versions where sheet_id = $1 and id <> $2 and state in ('published','in_review')",
    [sheetId, newVersionId],
  );
  for (const other of others) {
    await query('update versions set state = $2, replaced_by = $3 where id = $1', [other.id, 'voided', newNumber]);
  }
  await query('update versions set replaced_by = $2 where sheet_id = $1 and id <> $3 and replaced_by is null', [
    sheetId,
    newNumber,
    newVersionId,
  ]);
}

/** A version becomes published, and takes its number, only once MinIO confirms both objects. */
export async function publishVersion(state: DrawingState, sheet: SheetRow): Promise<VersionRow> {
  const existing = await versionsOfSheet(sheet.id);
  const number = existing.reduce((highest, version) => Math.max(highest, version.number), 0) + 1;
  const snapshot = await buildSnapshot(state, sheet);
  const id = newId('ver');
  const keys = versionKeys(sheet.id, number);
  await query(
    'insert into versions (id, sheet_id, number, state, snapshot, keys) values ($1,$2,$3,$4,$5,$6)',
    [id, sheet.id, number, 'publishing', JSON.stringify(snapshot), JSON.stringify(keys)],
  );
  try {
    await putObject(keys[0], Buffer.from(JSON.stringify(snapshot), 'utf8'));
    await putObject(keys[1], Buffer.from(sheetSvg(snapshot), 'utf8'));
  } catch (error) {
    await query('delete from versions where id = $1', [id]);
    if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable', MESSAGES.publishOutage);
    throw error;
  }
  await query('update versions set state = $2 where id = $1', [id, 'published']);
  const previous = existing
    .filter((version) => version.state !== 'publishing')
    .sort((a, b) => b.number - a.number)[0] ?? null;
  const version = (await versionById(id)) as VersionRow;
  await voidOlderVersions(sheet.id, number, id);
  await carryMarkups(previous, version);
  await broadcast(state, 'version', {
    sheet_id: sheet.id,
    version: await versionPayload(version),
    number,
  });
  await notifyXrefHosts(state.id, number);
  return version;
}

/** Everyone viewing a host drawing hears that a source published again. */
async function notifyXrefHosts(sourceDrawingId: string, number: number): Promise<void> {
  const rows = await query<{ id: string }>('select id from drawings', []);
  for (const row of rows) {
    const host = cachedDrawings().find((candidate) => candidate.id === row.id) ?? null;
    const state = host ?? (await loadDrawing(row.id));
    if (!state || state.id === sourceDrawingId) continue;
    for (const xref of state.model.xrefs) {
      if (xref.source !== sourceDrawingId) continue;
      await broadcast(state, 'xref_version', { name: xref.name, number });
    }
  }
}

export async function compareVersions(sheetId: string, from: number, to: number): Promise<Record<string, unknown>> {
  const versions = await versionsOfSheet(sheetId);
  const earlier = versions.find((version) => version.number === from);
  const later = versions.find((version) => version.number === to);
  if (!earlier || !later) throw new ApiError('not_found', MESSAGES.notFound);
  const result = compareSnapshots(earlier.snapshot, later.snapshot);
  return { added: result.added, removed: result.removed, changed: result.changed, entities: result.entities };
}

export async function markupsOf(versionId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<{
    id: string;
    kind: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    text: string | null;
    flag: string | null;
    author: string;
  }>('select id, kind, x1, y1, x2, y2, text, flag, author from markups where version_id = $1 order by created_at', [versionId]);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    x1: Number(row.x1),
    y1: Number(row.y1),
    x2: Number(row.x2),
    y2: Number(row.y2),
    text: row.text,
    flag: row.flag,
    author: row.author,
  }));
}
