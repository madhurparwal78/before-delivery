import type { PoolClient } from 'pg';
import type { ObjectType, PlotStyle } from '../shared/api';
import type { Units } from '../shared/format';
import { copy } from '../shared/copy';
import type { DrawingState, LayerRecord, LayoutRecord, XrefRecord } from './drawings';
import { currentLayer } from './drawings';
import type { ObjectGeometry, StoredObject } from './model';
import { queryOn } from './db';

export interface VersionSnapshot {
  objects: Record<string, StoredObject | null>;
  layers?: LayerRecord[];
  layouts?: LayoutRecord[];
  xrefs?: XrefRecord[];
  model?: { units: Units; plot_style: PlotStyle };
}

/** Accumulates one command's changes so they can be applied, snapshotted and reversed. */
export class EditSession {
  readonly objects: Map<string, StoredObject>;
  layers: LayerRecord[];
  layouts: LayoutRecord[];
  xrefs: XrefRecord[];
  units: Units;
  plotStyle: PlotStyle;
  nextHandle: number;
  objectSeq: number;

  readonly created = new Set<string>();
  readonly modified = new Set<string>();
  readonly erased = new Set<string>();
  readonly lockedOut: string[] = [];
  history: string | null = null;
  layersTouched = false;
  layoutsTouched = false;
  xrefsTouched = false;
  modelTouched = false;

  private readonly beforeObjects = new Map<string, StoredObject | null>();
  private readonly layersBefore: LayerRecord[];
  private readonly layoutsBefore: LayoutRecord[];
  private readonly xrefsBefore: XrefRecord[];
  private readonly modelBefore: { units: Units; plot_style: PlotStyle };

  constructor(state: DrawingState) {
    this.objects = new Map(state.objects.map((object) => [object.handle, structuredClone(object)]));
    this.layers = structuredClone(state.layers);
    this.layouts = structuredClone(state.layouts);
    this.xrefs = structuredClone(state.xrefs);
    this.units = state.record.units;
    this.plotStyle = state.record.plot_style;
    this.nextHandle = state.record.next_handle;
    this.objectSeq = state.record.object_seq;
    this.layersBefore = structuredClone(state.layers);
    this.layoutsBefore = structuredClone(state.layouts);
    this.xrefsBefore = structuredClone(state.xrefs);
    this.modelBefore = { units: state.record.units, plot_style: state.record.plot_style };
  }

  private remember(handle: string): void {
    if (this.beforeObjects.has(handle)) return;
    const existing = this.objects.get(handle);
    this.beforeObjects.set(handle, existing === undefined ? null : structuredClone(existing));
  }

  get currentLayerName(): string {
    return currentLayer(this.layers).name;
  }

  isLocked(layerName: string): boolean {
    return this.layers.some((layer) => layer.name === layerName && layer.locked);
  }

  nextHandleName(): string {
    const handle = this.nextHandle.toString(16).toUpperCase();
    this.nextHandle += 1;
    return handle;
  }

  createObject(type: ObjectType, data: ObjectGeometry, layerName?: string): StoredObject {
    const handle = this.nextHandleName();
    this.objectSeq += 1;
    const object: StoredObject = {
      handle,
      type,
      layer: layerName ?? this.currentLayerName,
      color: 'ByLayer',
      linetype: 'ByLayer',
      linetype_scale: 1,
      lineweight: 'ByLayer',
      dimension_style: 'Standard',
      text_style: 'Standard',
      multileader_style: 'Standard',
      data,
      ord: this.objectSeq,
    };
    this.remember(handle);
    this.objects.set(handle, object);
    this.created.add(handle);
    this.erased.delete(handle);
    return object;
  }

  /** Restores an object exactly as a snapshot held it. */
  restoreObject(object: StoredObject): void {
    this.remember(object.handle);
    const existed = this.objects.has(object.handle);
    this.objects.set(object.handle, structuredClone(object));
    this.erased.delete(object.handle);
    if (existed) this.modified.add(object.handle);
    else this.created.add(object.handle);
  }

  replaceGeometry(handle: string, data: ObjectGeometry, type?: ObjectType): void {
    const object = this.objects.get(handle);
    if (object === undefined) return;
    this.remember(handle);
    object.data = data;
    if (type !== undefined) object.type = type;
    if (!this.created.has(handle)) this.modified.add(handle);
  }

  patchObject(handle: string, fields: Partial<Omit<StoredObject, 'handle' | 'ord'>>): void {
    const object = this.objects.get(handle);
    if (object === undefined) return;
    this.remember(handle);
    Object.assign(object, fields);
    if (!this.created.has(handle)) this.modified.add(handle);
  }

  eraseObject(handle: string): void {
    if (!this.objects.has(handle)) return;
    this.remember(handle);
    this.objects.delete(handle);
    this.modified.delete(handle);
    if (this.created.has(handle)) this.created.delete(handle);
    else this.erased.add(handle);
  }

  /** Commands and Properties changes leave objects on locked layers untouched. */
  editable(handles: string[]): StoredObject[] {
    const result: StoredObject[] = [];
    for (const handle of handles) {
      const object = this.objects.get(handle);
      if (object === undefined) continue;
      if (this.isLocked(object.layer)) {
        this.lockedOut.push(handle);
        continue;
      }
      result.push(object);
    }
    return result;
  }

  finishLockedHistory(): void {
    if (this.lockedOut.length > 0 && this.history === null) {
      this.history = copy.history.lockedObjects(this.lockedOut.length);
    }
  }

  touchLayers(): void {
    this.layersTouched = true;
  }

  touchLayouts(): void {
    this.layoutsTouched = true;
  }

  touchXrefs(): void {
    this.xrefsTouched = true;
  }

  touchModel(): void {
    this.modelTouched = true;
  }

  get changedHandles(): string[] {
    return [...new Set([...this.created, ...this.modified, ...this.erased])].sort(compareHandles);
  }

  get hasChanges(): boolean {
    return (
      this.created.size > 0 ||
      this.modified.size > 0 ||
      this.erased.size > 0 ||
      this.layersTouched ||
      this.layoutsTouched ||
      this.xrefsTouched ||
      this.modelTouched
    );
  }

  beforeSnapshot(): VersionSnapshot {
    const objects: Record<string, StoredObject | null> = {};
    for (const [handle, object] of this.beforeObjects) objects[handle] = object;
    const snapshot: VersionSnapshot = { objects };
    if (this.layersTouched) snapshot.layers = this.layersBefore;
    if (this.layoutsTouched) snapshot.layouts = this.layoutsBefore;
    if (this.xrefsTouched) snapshot.xrefs = this.xrefsBefore;
    if (this.modelTouched) snapshot.model = this.modelBefore;
    return snapshot;
  }

  afterSnapshot(): VersionSnapshot {
    const objects: Record<string, StoredObject | null> = {};
    for (const handle of this.beforeObjects.keys()) objects[handle] = this.objects.get(handle) ?? null;
    const snapshot: VersionSnapshot = { objects };
    if (this.layersTouched) snapshot.layers = this.layers;
    if (this.layoutsTouched) snapshot.layouts = this.layouts;
    if (this.xrefsTouched) snapshot.xrefs = this.xrefs;
    if (this.modelTouched) snapshot.model = { units: this.units, plot_style: this.plotStyle };
    return snapshot;
  }

  /** Applies a stored snapshot, used by UNDO and REDO. */
  applySnapshot(snapshot: VersionSnapshot): void {
    for (const [handle, object] of Object.entries(snapshot.objects)) {
      if (object === null) this.eraseObject(handle);
      else this.restoreObject(object);
    }
    if (snapshot.layers !== undefined) {
      this.layers = structuredClone(snapshot.layers);
      this.touchLayers();
    }
    if (snapshot.layouts !== undefined) {
      this.layouts = structuredClone(snapshot.layouts);
      this.touchLayouts();
    }
    if (snapshot.xrefs !== undefined) {
      this.xrefs = structuredClone(snapshot.xrefs);
      this.touchXrefs();
    }
    if (snapshot.model !== undefined) {
      this.units = snapshot.model.units;
      this.plotStyle = snapshot.model.plot_style;
      this.touchModel();
    }
  }
}

export function compareHandles(a: string, b: string): number {
  const left = Number.parseInt(a.replace(/^T/, ''), 16);
  const right = Number.parseInt(b.replace(/^T/, ''), 16);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.localeCompare(b);
}

export async function persistSession(
  client: PoolClient,
  drawingId: string,
  session: EditSession,
  modifiedAt: Date,
): Promise<number> {
  for (const handle of session.erased) {
    await client.query('delete from objects where drawing_id = $1 and handle = $2', [drawingId, handle]);
  }
  for (const handle of session.created) {
    const object = session.objects.get(handle);
    if (object === undefined) continue;
    await client.query(
      `insert into objects (drawing_id, handle, type, layer, color, linetype, linetype_scale, lineweight,
        dimension_style, text_style, multileader_style, data, ord)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (drawing_id, handle) do update set type = excluded.type, layer = excluded.layer,
        color = excluded.color, linetype = excluded.linetype, linetype_scale = excluded.linetype_scale,
        lineweight = excluded.lineweight, dimension_style = excluded.dimension_style,
        text_style = excluded.text_style, multileader_style = excluded.multileader_style,
        data = excluded.data, ord = excluded.ord`,
      [
        drawingId,
        object.handle,
        object.type,
        object.layer,
        object.color,
        object.linetype,
        object.linetype_scale,
        object.lineweight,
        object.dimension_style,
        object.text_style,
        object.multileader_style,
        JSON.stringify(object.data),
        object.ord,
      ],
    );
  }
  for (const handle of session.modified) {
    const object = session.objects.get(handle);
    if (object === undefined) continue;
    await client.query(
      `update objects set type = $3, layer = $4, color = $5, linetype = $6, linetype_scale = $7,
        lineweight = $8, dimension_style = $9, text_style = $10, multileader_style = $11, data = $12
       where drawing_id = $1 and handle = $2`,
      [
        drawingId,
        object.handle,
        object.type,
        object.layer,
        object.color,
        object.linetype,
        object.linetype_scale,
        object.lineweight,
        object.dimension_style,
        object.text_style,
        object.multileader_style,
        JSON.stringify(object.data),
      ],
    );
  }
  if (session.layersTouched) {
    await client.query('delete from layers where drawing_id = $1', [drawingId]);
    for (const [index, layer] of session.layers.entries()) {
      await client.query(
        `insert into layers (drawing_id, name, color, linetype, lineweight, is_on, frozen, locked, is_current, ord)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          drawingId,
          layer.name,
          layer.color,
          layer.linetype,
          layer.lineweight,
          layer.on,
          layer.frozen,
          layer.locked,
          layer.current,
          index,
        ],
      );
    }
  }
  if (session.layoutsTouched) {
    await client.query('delete from layouts where drawing_id = $1', [drawingId]);
    for (const [index, layout] of session.layouts.entries()) {
      await client.query('insert into layouts (drawing_id, name, viewport_scale, ord) values ($1,$2,$3,$4)', [
        drawingId,
        layout.name,
        layout.viewport_scale,
        index,
      ]);
    }
  }
  if (session.xrefsTouched) {
    await client.query('delete from xrefs where drawing_id = $1', [drawingId]);
    for (const xref of session.xrefs) {
      await client.query(
        'insert into xrefs (id, drawing_id, source_drawing_id, name, status) values ($1,$2,$3,$4,$5)',
        [xref.id, drawingId, xref.source_drawing_id, xref.name, xref.status],
      );
    }
  }
  const updated = await queryOn<{ version: number }>(client, 
    `update drawings set version = version + 1, next_handle = $2, object_seq = $3, units = $4,
       plot_style = $5, modified_at = $6
     where id = $1 returning version`,
    [drawingId, session.nextHandle, session.objectSeq, session.units, session.plotStyle, modifiedAt],
  );
  return updated[0]!.version;
}
