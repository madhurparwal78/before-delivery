// Drawing persistence: model load/save, the drawing view, creation, and the version check every base write shares.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { COPY, copy } from '../shared/copy.ts';
import { presentObject } from '../shared/geometry.ts';
import type {
  Access, ApiObject, DrawingView, Layer, LayerView, Layout, PlotStyle, StoredObject, TraceSummary, Units, ViewportScale, XrefStatus, XrefView,
} from '../shared/types.ts';
import type { DrawingRow } from './access.ts';
import { query, transaction, type Queryable } from './db.ts';
import { HttpError } from './http.ts';
import type { DxfImport } from './formats/dxf.ts';
import { StorageUnavailable } from './s3.ts';
import { intersectionPoints } from './engine/index.ts';
import type { DrawingModel, Patch } from './engine/types.ts';

/** The handle space starts at hex 10; an imported or fresh drawing numbers from here. */
const FIRST_HANDLE = 16;

const SAMPLE_OWNER = 'Corbel Works';
const FILE_NAME_FORBIDDEN = /[/\\:*?"<>|]/;

interface LayerRow { name: string; color: Layer['color']; linetype: Layer['linetype']; lineweight: Layer['lineweight']; on_: boolean; frozen: boolean; locked: boolean; current: boolean }
interface LayoutRow { name: string; viewport_scale: ViewportScale | null }

/** Handles are uppercase hex; numeric order is the order they were allocated in. */
function handleValue(handle: string): number {
  return parseInt(handle, 16);
}

export function sortHandles(handles: Iterable<string>): string[] {
  return [...handles].sort((a, b) => handleValue(a) - handleValue(b));
}

/** The numeric value the next handle takes after `objects`; a replaced drawing starts again at hex 10. */
function nextHandleAfter(objects: readonly StoredObject[]): number {
  return objects.reduce((next, o) => Math.max(next, handleValue(o.handle) + 1), FIRST_HANDLE);
}

export function presentAll(objects: readonly StoredObject[], units: Units): ApiObject[] {
  return objects.map((o) => presentObject(o, units));
}

/** File name rules shared by New Drawing, Save as and uploads: 1 to 80 characters, no path characters, `.dxf` appended. */
export function drawingFileName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > 80 || FILE_NAME_FORBIDDEN.test(name)) return null;
  return name.toLowerCase().endsWith('.dxf') ? name : `${name}.dxf`;
}

export function fileNameError(): HttpError {
  return new HttpError(422, { errors: { name: COPY.fileNameInvalid } });
}

export function nameTakenError(name: string): HttpError {
  return new HttpError(422, { errors: { name: copy.fileTaken(name) } });
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Smallest free `Drawing<n>.dxf` in a folder. */
export async function defaultDrawingName(client: Queryable, folderId: string): Promise<string> {
  const { rows } = await client.query<{ name_key: string }>(
    'SELECT name_key FROM drawings WHERE folder_id = $1 AND deleted_at IS NULL', [folderId]);
  const taken = new Set(rows.map((r) => r.name_key));
  let n = 1;
  while (taken.has(`drawing${n}.dxf`)) n += 1;
  return `Drawing${n}.dxf`;
}

export async function loadModel(client: Queryable, drawingId: string): Promise<DrawingModel> {
  const drawing = await client.query<{ units: Units; plot_style: PlotStyle; next_handle: number }>(
    'SELECT units, plot_style, next_handle FROM drawings WHERE id = $1', [drawingId]);
  const layers = await client.query<LayerRow>(
    'SELECT name, color, linetype, lineweight, on_, frozen, locked, current FROM layers WHERE drawing_id = $1 ORDER BY position', [drawingId]);
  const objects = await client.query<{ data: StoredObject }>(
    'SELECT data FROM objects WHERE drawing_id = $1 ORDER BY seq', [drawingId]);
  const layouts = await client.query<LayoutRow>(
    'SELECT name, viewport_scale FROM layouts WHERE drawing_id = $1 ORDER BY position', [drawingId]);
  const head = drawing.rows[0];
  if (!head) throw new HttpError(404, { error: 'not_found' });
  return {
    units: head.units,
    plot_style: head.plot_style,
    next_handle: head.next_handle,
    layers: layers.rows.map(({ on_, ...rest }) => ({ ...rest, on: on_ })),
    objects: objects.rows.map((r) => r.data),
    layouts: layouts.rows.map((r) => (r.viewport_scale ? { name: r.name, viewport_scale: r.viewport_scale } : { name: r.name })),
  };
}

async function writeLayers(client: Queryable, drawingId: string, layers: readonly Layer[]): Promise<void> {
  await client.query('DELETE FROM layers WHERE drawing_id = $1', [drawingId]);
  const rows = layers.map(({ on, ...rest }, position) => ({ ...rest, on_: on, position }));
  await client.query(
    `INSERT INTO layers (drawing_id, name, position, color, linetype, lineweight, on_, frozen, locked, current)
     SELECT $1, r.name, r.position, r.color, r.linetype, r.lineweight, r.on_, r.frozen, r.locked, r.current
     FROM jsonb_to_recordset($2::jsonb) AS r(name text, position integer, color text, linetype text, lineweight text, on_ boolean, frozen boolean, locked boolean, current boolean)`,
    [drawingId, JSON.stringify(rows)]);
}

async function writeLayouts(client: Queryable, drawingId: string, layouts: readonly Layout[]): Promise<void> {
  await client.query('DELETE FROM layouts WHERE drawing_id = $1', [drawingId]);
  const rows = layouts.map((l, position) => ({ name: l.name, position, viewport_scale: l.viewport_scale ?? null }));
  await client.query(
    `INSERT INTO layouts (drawing_id, name, position, viewport_scale)
     SELECT $1, r.name, r.position, r.viewport_scale
     FROM jsonb_to_recordset($2::jsonb) AS r(name text, position integer, viewport_scale text)`,
    [drawingId, JSON.stringify(rows)]);
}

async function insertObjects(client: Queryable, drawingId: string, objects: readonly StoredObject[], seqOf: (handle: string) => number): Promise<{ inserted: number }> {
  if (objects.length === 0) return { inserted: 0 };
  const rows = objects.map((o) => ({ handle: o.handle, seq: seqOf(o.handle), data: o }));
  const result = await client.query<{ inserted: boolean }>(
    `INSERT INTO objects (drawing_id, handle, seq, data)
     SELECT $1, r.handle, r.seq, r.data FROM jsonb_to_recordset($2::jsonb) AS r(handle text, seq bigint, data jsonb)
     ON CONFLICT (drawing_id, handle) DO UPDATE SET data = EXCLUDED.data
     RETURNING (xmax = 0) AS inserted`,
    [drawingId, JSON.stringify(rows)]);
  return { inserted: result.rows.filter((r) => r.inserted).length };
}

/** Replaces every stored part of a drawing's model: used by creation, uploads and restores. */
export async function replaceModel(client: Queryable, drawingId: string, model: DrawingModel): Promise<void> {
  await client.query('DELETE FROM objects WHERE drawing_id = $1', [drawingId]);
  const order = new Map(model.objects.map((o, i) => [o.handle, i]));
  await insertObjects(client, drawingId, model.objects, (h) => order.get(h) ?? 0);
  await writeLayers(client, drawingId, model.layers);
  await writeLayouts(client, drawingId, model.layouts);
  await client.query('UPDATE drawings SET units = $2, plot_style = $3, next_handle = $4 WHERE id = $1',
    [drawingId, model.units, model.plot_style, model.next_handle]);
}

/**
 * Writes the part of `next` that `patch` describes. Stored creation order follows the model's object order, so rows
 * are renumbered when an object appears or disappears.
 */
export async function writePatch(client: Queryable, drawingId: string, patch: Patch, next: DrawingModel): Promise<void> {
  const present: StoredObject[] = [];
  const erased: string[] = [];
  for (const [handle, state] of Object.entries(patch.objects)) {
    if (state) present.push(state);
    else erased.push(handle);
  }
  const order = new Map(next.objects.map((o, i) => [o.handle, i]));
  const { inserted } = await insertObjects(client, drawingId, present, (h) => order.get(h) ?? 0);
  const removed = erased.length === 0 ? 0 : (await client.query(
    'DELETE FROM objects WHERE drawing_id = $1 AND handle = ANY($2::text[])', [drawingId, erased])).rowCount ?? 0;
  if (inserted + removed > 0) {
    await client.query(
      `UPDATE objects o SET seq = t.position
       FROM unnest($2::text[]) WITH ORDINALITY AS t(handle, position)
       WHERE o.drawing_id = $1 AND o.handle = t.handle AND o.seq <> t.position`,
      [drawingId, next.objects.map((o) => o.handle)]);
  }
  if (patch.layers) await writeLayers(client, drawingId, next.layers);
  if (patch.layouts) await writeLayouts(client, drawingId, next.layouts);
}

interface NewDrawing {
  workspaceId: string;
  folderId: string | null;
  name: string;
  model: DrawingModel;
  sample?: boolean;
  at: Date;
}

export async function createDrawing(client: PoolClient, input: NewDrawing): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO drawings (id, workspace_id, folder_id, name, name_key, sample, units, plot_style, version, next_handle, created_at, modified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $10)`,
    [id, input.workspaceId, input.folderId, input.name, input.name.toLowerCase(), input.sample ?? false,
      input.model.units, input.model.plot_style, input.model.next_handle, input.at]);
  await replaceModel(client, id, input.model);
  return id;
}

/** Every handle created, modified or erased by versions after `version`, in handle order. */
async function changedSince(client: Queryable, drawingId: string, version: number): Promise<string[]> {
  const { rows } = await client.query<{ handle: string }>(
    `SELECT DISTINCT h AS handle FROM changes c, unnest(c.created || c.modified || c.erased) AS h
     WHERE c.drawing_id = $1 AND c.version > $2`, [drawingId, version]);
  return sortHandles(rows.map((r) => r.handle));
}

interface LockedDrawing { id: string; workspace_id: string; name: string; version: number; folder_id: string | null }

/** The one version check: locks the drawing row, and refuses a stale `baseVersion` with the handles changed since. */
export async function lockDrawing(client: Queryable, drawingId: string, baseVersion: number): Promise<LockedDrawing> {
  const locked = await lockDrawingRow(client, drawingId);
  if (locked.version !== baseVersion) {
    throw new HttpError(409, {
      error: 'version_conflict',
      current_version: locked.version,
      changed: await changedSince(client, drawingId, baseVersion),
    });
  }
  return locked;
}

export async function lockDrawingRow(client: Queryable, drawingId: string): Promise<LockedDrawing> {
  const { rows } = await client.query<LockedDrawing>(
    'SELECT id, workspace_id, name, version, folder_id FROM drawings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [drawingId]);
  const locked = rows[0];
  if (!locked) throw new HttpError(404, { error: 'not_found' });
  return locked;
}

/** Raises the version by exactly 1 and stamps Date Modified; `model` carries the units, plot style and handle counter. */
export async function bumpVersion(client: Queryable, drawingId: string, model: DrawingModel, at: Date): Promise<number> {
  const { rows } = await client.query<{ version: number }>(
    `UPDATE drawings SET version = version + 1, modified_at = $2, units = $3, plot_style = $4, next_handle = $5
     WHERE id = $1 RETURNING version`,
    [drawingId, at, model.units, model.plot_style, model.next_handle]);
  const row = rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  return row.version;
}

async function xrefViews(client: Queryable, drawingId: string, units: Units): Promise<{ views: XrefView[]; loadedObjects: StoredObject[] }> {
  const { rows } = await client.query<{ id: string; source_drawing_id: string; loaded: boolean; name: string | null; deleted_at: Date | null }>(
    `SELECT x.id, x.source_drawing_id, x.loaded, s.name, s.deleted_at
     FROM xrefs x JOIN drawings s ON s.id = x.source_drawing_id
     WHERE x.drawing_id = $1 ORDER BY x.position`, [drawingId]);
  const views: XrefView[] = [];
  const loadedObjects: StoredObject[] = [];
  for (const row of rows) {
    const status: XrefStatus = row.deleted_at ? 'not_found' : row.loaded ? 'loaded' : 'unloaded';
    let objects: ApiObject[] = [];
    if (status === 'loaded') {
      const source = await client.query<{ data: StoredObject }>('SELECT data FROM objects WHERE drawing_id = $1 ORDER BY seq', [row.source_drawing_id]);
      const stored = source.rows.map((r) => r.data);
      loadedObjects.push(...stored);
      objects = presentAll(stored, units);
    }
    views.push({ id: row.id, drawing_id: row.source_drawing_id, name: row.name ?? '', status, objects });
  }
  return { views, loadedObjects };
}

async function traceSummaries(client: Queryable, drawingId: string): Promise<TraceSummary[]> {
  const { rows } = await client.query<TraceSummary>(
    `SELECT id, name, state, author_name AS author, notice FROM traces WHERE drawing_id = $1 ORDER BY created_at, id`, [drawingId]);
  return rows;
}

async function ownerName(client: Queryable, drawing: Pick<DrawingRow, 'workspace_id' | 'sample'>): Promise<string> {
  if (drawing.sample) return SAMPLE_OWNER;
  const { rows } = await client.query<{ name: string }>(
    'SELECT name FROM users WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [drawing.workspace_id]);
  return rows[0]?.name ?? SAMPLE_OWNER;
}

async function rootFolderId(client: Queryable, workspaceId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM folders WHERE workspace_id = $1 AND parent_id IS NULL', [workspaceId]);
  const root = rows[0];
  if (!root) throw new HttpError(404, { error: 'not_found' });
  return root.id;
}

async function drawingView(client: Queryable, drawing: DrawingRow, access: Access): Promise<DrawingView> {
  const head = await client.query<{ name: string; folder_id: string | null; version: number }>(
    'SELECT name, folder_id, version FROM drawings WHERE id = $1', [drawing.id]);
  const row = head.rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  const model = await loadModel(client, drawing.id);
  const xrefs = await xrefViews(client, drawing.id, model.units);
  const counts = new Map<string, number>();
  for (const o of model.objects) counts.set(o.layer, (counts.get(o.layer) ?? 0) + 1);
  const layers: LayerView[] = model.layers.map((l) => ({ ...l, objects: counts.get(l.name) ?? 0 }));
  return {
    id: drawing.id,
    name: row.name,
    folder_id: row.folder_id ?? await rootFolderId(client, drawing.workspace_id),
    owner: { name: await ownerName(client, drawing) },
    units: model.units,
    plot_style: model.plot_style,
    version: row.version,
    access,
    layers,
    objects: presentAll(model.objects, model.units),
    intersections: intersectionPoints(model, xrefs.loadedObjects),
    layouts: model.layouts,
    xrefs: xrefs.views,
    traces: await traceSummaries(client, drawing.id),
  };
}

/** A drawing view read from one snapshot, so its version always matches its objects. */
export function readDrawingView(drawing: DrawingRow, access: Access): Promise<DrawingView> {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return drawingView(client, drawing, access);
  });
}

export async function drawingRowOf(drawingId: string): Promise<DrawingRow> {
  const rows = await query<DrawingRow>('SELECT * FROM drawings WHERE id = $1', [drawingId]);
  const row = rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  return row;
}

/** `base` with the objects, layers and units of an import; handle numbering restarts after the imported handles. */
export function modelFromImport(base: DrawingModel, imported: DxfImport): DrawingModel {
  return { ...base, units: imported.units, layers: imported.layers, objects: imported.objects, next_handle: nextHandleAfter(imported.objects) };
}

/** Runs a MinIO call; when MinIO does not confirm it, the request answers the published 503. */
export async function viaStorage<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new HttpError(503, { error: 'storage_unavailable' });
    throw error;
  }
}
