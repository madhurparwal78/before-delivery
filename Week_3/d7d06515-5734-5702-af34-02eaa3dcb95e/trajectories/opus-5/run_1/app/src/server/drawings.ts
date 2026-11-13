import type { PoolClient } from 'pg';
import type {
  AccessLevel,
  Drawing,
  LayerRow,
  LayoutRow,
  PlotStyle,
  Point,
  TraceSummary,
  ViewportScale,
  XrefRow,
} from '../shared/api';
import type { Units } from '../shared/format';
import { pool, query, queryOn } from './db';
import { intersectionPoints, serializeObject, type StoredObject } from './model';
import type { Extents } from './geometry';
import { mergeExtents } from './geometry';
import { objectExtents } from './model';

export interface DrawingRecord {
  id: string;
  workspace_id: string;
  folder_id: string;
  name: string;
  units: Units;
  plot_style: PlotStyle;
  version: number;
  owner_user_id: string | null;
  is_sample: boolean;
  next_handle: number;
  export_count: number;
  trace_counter: number;
  issue_counter: number;
  object_seq: number;
  modified_at: Date;
  created_at: Date;
}

export interface LayerRecord {
  name: string;
  color: string;
  linetype: string;
  lineweight: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  ord: number;
}

export interface LayoutRecord {
  name: string;
  viewport_scale: ViewportScale | null;
  ord: number;
}

export interface XrefRecord {
  id: string;
  source_drawing_id: string;
  name: string;
  status: 'loaded' | 'unloaded';
}

export interface DrawingState {
  record: DrawingRecord;
  layers: LayerRecord[];
  objects: StoredObject[];
  layouts: LayoutRecord[];
  xrefs: XrefRecord[];
}

type Runner = Pick<PoolClient, 'query'>;

function runner(client?: Runner): Runner {
  return client ?? pool;
}

export async function findDrawingRecord(id: string, client?: Runner): Promise<DrawingRecord | null> {
  const result = await queryOn<DrawingRecord>(runner(client), 'select * from drawings where id = $1', [id]);
  return result[0] ?? null;
}

export async function lockDrawingRecord(client: Runner, id: string): Promise<DrawingRecord | null> {
  const result = await queryOn<DrawingRecord>(runner(client), 'select * from drawings where id = $1 for update', [id]);
  return result[0] ?? null;
}

export async function loadLayers(drawingId: string, client?: Runner): Promise<LayerRecord[]> {
  const result = await queryOn<{
    name: string;
    color: string;
    linetype: string;
    lineweight: string;
    is_on: boolean;
    frozen: boolean;
    locked: boolean;
    is_current: boolean;
    ord: number;
  }>(runner(client), 'select * from layers where drawing_id = $1 order by ord, name', [drawingId]);
  return result.map((row) => ({
    name: row.name,
    color: row.color,
    linetype: row.linetype,
    lineweight: row.lineweight,
    on: row.is_on,
    frozen: row.frozen,
    locked: row.locked,
    current: row.is_current,
    ord: row.ord,
  }));
}

export async function loadObjects(drawingId: string, client?: Runner): Promise<StoredObject[]> {
  const result = await queryOn<{
    handle: string;
    type: StoredObject['type'];
    layer: string;
    color: string;
    linetype: string;
    linetype_scale: number;
    lineweight: string;
    dimension_style: string;
    text_style: string;
    multileader_style: string;
    data: StoredObject['data'];
    ord: number;
  }>(runner(client), 'select * from objects where drawing_id = $1 order by ord', [drawingId]);
  return result.map((row) => ({ ...row }));
}

export async function loadLayouts(drawingId: string, client?: Runner): Promise<LayoutRecord[]> {
  const result = await queryOn<LayoutRecord>(runner(client), 
    'select name, viewport_scale, ord from layouts where drawing_id = $1 order by ord',
    [drawingId],
  );
  return result;
}

export async function loadXrefRecords(drawingId: string, client?: Runner): Promise<XrefRecord[]> {
  const result = await queryOn<XrefRecord>(runner(client), 
    'select id, source_drawing_id, name, status from xrefs where drawing_id = $1 order by ord',
    [drawingId],
  );
  return result;
}

export async function loadDrawingState(drawingId: string, client?: Runner): Promise<DrawingState | null> {
  const record = await findDrawingRecord(drawingId, client);
  if (record === null) return null;
  const [layers, objects, layouts, xrefs] = await Promise.all([
    loadLayers(drawingId, client),
    loadObjects(drawingId, client),
    loadLayouts(drawingId, client),
    loadXrefRecords(drawingId, client),
  ]);
  return { record, layers, objects, layouts, xrefs };
}

export function layerByName(layers: LayerRecord[], name: string): LayerRecord | undefined {
  return layers.find((layer) => layer.name.toLowerCase() === name.toLowerCase());
}

/** A layer that is off or frozen is not drawn, snapped to, selected or counted in the extents. */
export function isLayerVisible(layers: LayerRecord[], name: string): boolean {
  const layer = layerByName(layers, name);
  return layer !== undefined && layer.on && !layer.frozen;
}

export function visibleObjects(state: DrawingState): StoredObject[] {
  return state.objects.filter((object) => isLayerVisible(state.layers, object.layer));
}

export function currentLayer(layers: LayerRecord[]): LayerRecord {
  return layers.find((layer) => layer.current) ?? layers[0]!;
}

export const FALLBACK_EXTENTS: Extents = { min: [0, 0], max: [10000, 7000] };

/** The extents of every base object on a layer that is neither frozen nor off. */
export function drawingExtents(state: DrawingState): Extents {
  const boxes = visibleObjects(state)
    .map(objectExtents)
    .filter((box): box is Extents => box !== null);
  return mergeExtents(boxes) ?? FALLBACK_EXTENTS;
}

export async function loadXrefs(
  drawingId: string,
  units: Units,
  client?: Runner,
): Promise<{ rows: XrefRow[]; objects: StoredObject[] }> {
  const result = await queryOn<{
    id: string;
    source_drawing_id: string;
    name: string;
    status: string;
  }>(runner(client), 'select id, source_drawing_id, name, status from xrefs where drawing_id = $1 order by ord', [drawingId]);
  const rows: XrefRow[] = [];
  const loaded: StoredObject[] = [];
  for (const row of result) {
    const source = await findDrawingRecord(row.source_drawing_id, client);
    if (source === null) {
      rows.push({ id: row.id, drawing_id: row.source_drawing_id, name: row.name, status: 'not_found', objects: [] });
      continue;
    }
    if (row.status === 'unloaded') {
      rows.push({ id: row.id, drawing_id: row.source_drawing_id, name: row.name, status: 'unloaded', objects: [] });
      continue;
    }
    const sourceLayers = await loadLayers(source.id, client);
    const sourceObjects = (await loadObjects(source.id, client)).filter((object) =>
      isLayerVisible(sourceLayers, object.layer),
    );
    const all = new Map(sourceObjects.map((object) => [object.handle, object]));
    rows.push({
      id: row.id,
      drawing_id: row.source_drawing_id,
      name: row.name,
      status: 'loaded',
      objects: sourceObjects.map((object) => serializeObject(object, all, units)),
    });
    loaded.push(...sourceObjects);
  }
  return { rows, objects: loaded };
}

export async function loadTraceSummaries(drawingId: string): Promise<TraceSummary[]> {
  const rows = await query<{
    id: string;
    name: string;
    state: TraceSummary['state'];
    author: string;
    notice: TraceSummary['notice'];
  }>('select id, name, state, author, notice from traces where drawing_id = $1 order by seq', [drawingId]);
  return rows.map((row) => ({ ...row }));
}

export function layerRows(state: DrawingState): LayerRow[] {
  return state.layers.map((layer) => ({
    name: layer.name,
    color: layer.color as LayerRow['color'],
    linetype: layer.linetype,
    lineweight: layer.lineweight,
    on: layer.on,
    frozen: layer.frozen,
    locked: layer.locked,
    current: layer.current,
    objects: state.objects.filter((object) => object.layer === layer.name).length,
  }));
}

export function layoutRows(state: DrawingState): LayoutRow[] {
  return state.layouts.map((layout) =>
    layout.viewport_scale === null ? { name: layout.name } : { name: layout.name, viewport_scale: layout.viewport_scale },
  );
}

export async function serializeDrawing(
  state: DrawingState,
  access: AccessLevel,
  ownerName: string,
): Promise<Drawing> {
  const units = state.record.units;
  const all = new Map(state.objects.map((object) => [object.handle, object]));
  const xrefs = await loadXrefs(state.record.id, units);
  const traces = await loadTraceSummaries(state.record.id);
  const snapSources = [...visibleObjects(state), ...xrefs.objects];
  const intersections: Point[] = intersectionPoints(snapSources);
  return {
    id: state.record.id,
    name: state.record.name,
    folder_id: state.record.folder_id,
    owner: { name: ownerName },
    units,
    plot_style: state.record.plot_style,
    version: state.record.version,
    access,
    layers: layerRows(state),
    objects: state.objects.map((object) => serializeObject(object, all, units)),
    intersections,
    layouts: layoutRows(state),
    xrefs: xrefs.rows,
    traces,
  };
}
