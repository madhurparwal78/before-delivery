// Working copy of a drawing while one command runs; turns the edits into an outcome with before/after images.
import { copy } from '../../shared/copy.ts';
import { normalizeObject } from '../../shared/geometry.ts';
import type { Geometry, Layer, Layout, PlotStyle, StoredObject, Units } from '../../shared/types.ts';
import type { CommandOutcome, DrawingModel, Patch } from './types.ts';

export const handleValue = (handle: string): number => Number.parseInt(handle, 16);
const byHandle = (a: string, b: string): number => handleValue(a) - handleValue(b);

/** The default look every new object starts with. */
export function newObject(handle: string, layer: string, geometry: Geometry): StoredObject {
  return {
    handle, layer, color: 'ByLayer', linetype: 'ByLayer', linetype_scale: 1, lineweight: 'ByLayer',
    dimension_style: 'Standard', text_style: 'Standard', multileader_style: 'Standard', ...geometry,
  };
}

export class Draft {
  units: Units;
  plotStyle: PlotStyle;
  layers: Layer[];
  layouts: Layout[];
  private readonly base: DrawingModel;
  private readonly objects: (StoredObject | null)[];
  private readonly slot = new Map<string, number>();
  private readonly original = new Map<string, StoredObject | null>();
  private readonly uncounted = new Set<string>();
  private readonly lockedHandles: string[] = [];
  private nextHandle: number;
  private historyLine: string | null = null;

  constructor(base: DrawingModel) {
    this.base = base;
    this.units = base.units;
    this.plotStyle = base.plot_style;
    this.layers = base.layers;
    this.layouts = base.layouts;
    this.objects = base.objects.slice();
    this.nextHandle = base.next_handle;
    this.objects.forEach((o, i) => this.slot.set((o as StoredObject).handle, i));
  }

  get model(): DrawingModel {
    return this.base;
  }

  get(handle: string): StoredObject | undefined {
    const index = this.slot.get(handle);
    return index === undefined ? undefined : (this.objects[index] ?? undefined);
  }

  /** Live objects in creation order. */
  all(): StoredObject[] {
    return this.objects.filter((o): o is StoredObject => o !== null);
  }

  layer(name: string): Layer | undefined {
    return this.layers.find((l) => l.name === name);
  }

  get currentLayer(): Layer {
    return this.layers.find((l) => l.current) ?? (this.layers[0] as Layer);
  }

  isLocked(object: StoredObject): boolean {
    return this.layer(object.layer)?.locked === true;
  }

  isVisible(object: StoredObject): boolean {
    const layer = this.layer(object.layer);
    return layer !== undefined && layer.on && !layer.frozen;
  }

  /** Splits objects into those a command may touch and those on a locked layer, which it records and leaves out. */
  unlocked(objects: StoredObject[]): StoredObject[] {
    const open: StoredObject[] = [];
    for (const object of objects) {
      if (this.isLocked(object)) this.lockedHandles.push(object.handle);
      else open.push(object);
    }
    return open;
  }

  private remember(handle: string, before: StoredObject | null): void {
    if (!this.original.has(handle)) this.original.set(handle, before);
  }

  private allocate(): string {
    const handle = this.nextHandle.toString(16).toUpperCase();
    this.nextHandle += 1;
    return handle;
  }

  /** A new object on the current layer with the default look. */
  create(geometry: Geometry): StoredObject {
    return this.add(newObject(this.allocate(), this.currentLayer.name, geometry));
  }

  /** A new object with the look, layer and geometry of `source` under a fresh handle. */
  clone(source: StoredObject): StoredObject {
    return this.add({ ...source, handle: this.allocate() });
  }

  private add(object: StoredObject): StoredObject {
    const stored = normalizeObject(object);
    this.remember(stored.handle, null);
    this.slot.set(stored.handle, this.objects.length);
    this.objects.push(stored);
    return stored;
  }

  /** Replaces an object; `counted: false` records the new image without listing the handle as modified (layer renames). */
  replace(object: StoredObject, counted = true): StoredObject {
    const index = this.slot.get(object.handle);
    const before = index === undefined ? null : (this.objects[index] ?? null);
    if (index === undefined || before === null) throw new Error(`no object ${object.handle}`);
    this.remember(object.handle, before);
    if (!counted) this.uncounted.add(object.handle);
    const stored = normalizeObject(object);
    this.objects[index] = stored;
    return stored;
  }

  remove(handle: string): void {
    const index = this.slot.get(handle);
    const before = index === undefined ? null : (this.objects[index] ?? null);
    if (index === undefined || before === null) throw new Error(`no object ${handle}`);
    this.remember(handle, before);
    this.objects[index] = null;
  }

  /** Overrides the history line (for example `No cutting edge found.`). */
  say(line: string): void {
    this.historyLine = line;
  }

  finish(): CommandOutcome {
    const created: string[] = [];
    const modified: string[] = [];
    const erased: string[] = [];
    const patchBefore: Patch['objects'] = {};
    const patchAfter: Patch['objects'] = {};
    for (const [handle, before] of this.original) {
      const now = this.get(handle) ?? null;
      if (before === null && now === null) continue;
      if (before !== null && now !== null && JSON.stringify(before) === JSON.stringify(now)) continue;
      patchBefore[handle] = before;
      patchAfter[handle] = now;
      if (before === null) created.push(handle);
      else if (now === null) erased.push(handle);
      else if (!this.uncounted.has(handle)) modified.push(handle);
    }
    const before: Patch = { objects: patchBefore };
    const after: Patch = { objects: patchAfter };
    let changed = Object.keys(patchAfter).length > 0;
    if (JSON.stringify(this.layers) !== JSON.stringify(this.base.layers)) {
      before.layers = this.base.layers;
      after.layers = this.layers;
      changed = true;
    }
    if (JSON.stringify(this.layouts) !== JSON.stringify(this.base.layouts)) {
      before.layouts = this.base.layouts;
      after.layouts = this.layouts;
      changed = true;
    }
    if (this.units !== this.base.units) {
      before.units = this.base.units;
      after.units = this.units;
      changed = true;
    }
    if (this.plotStyle !== this.base.plot_style) {
      before.plot_style = this.base.plot_style;
      after.plot_style = this.plotStyle;
      changed = true;
    }
    const locked = this.lockedHandles.slice().sort(byHandle);
    const history = this.historyLine ?? (locked.length > 0 ? copy.lockedObjects(locked.length) : null);
    return {
      created: created.sort(byHandle), modified: modified.sort(byHandle), erased: erased.sort(byHandle), locked, history, changed,
      next: {
        units: this.units, plot_style: this.plotStyle, layers: this.layers, layouts: this.layouts, objects: this.all(),
        next_handle: this.nextHandle,
      },
      before, after,
    };
  }
}
