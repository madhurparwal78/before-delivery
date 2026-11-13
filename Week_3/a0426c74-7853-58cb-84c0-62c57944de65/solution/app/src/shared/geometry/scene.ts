// The scene: one SceneEntity per model entity, then per xref entity, with effective properties, bounds, visibility and a spatial index.
// updateScene is incremental by object identity: only entities whose objects changed, and what depends on them, are rebuilt.
import type { BlockDef, ColourName, DimStyle, DrawingState, Entity, Layer, Linetype, Lineweight, ModelSnapshot, Rect } from '../types.ts';
import { type Prim, rectsMeet, unionRect } from './curves.ts';
import { STANDARD_DIM_STYLE } from './dimension.ts';
import { compareHandles, distance, midpoint } from './numbers.ts';
import { entityGeometry } from './prims.ts';
import { GridIndex } from './spatial.ts';
import { effectiveColour } from './transform.ts';
import { type Size, type View, viewWorldRect } from './view.ts';
import { type XrefItem, flattenXrefs } from './xref.ts';

/** What a scene is built from: a `DrawingState`, or a published model through `modelInput`. */
export type SceneInput = Pick<DrawingState, 'layers' | 'entities' | 'blocks' | 'dim_styles' | 'xrefs'>;

/** An xref clip as a world rectangle, with the id its `<clipPath>` has in `renderDefs`. */
export interface ClipRect { id: string; rect: Rect }

export interface SceneEntity {
  /** model handle (`L1`), optimistic id (`new-3`), or `<xref path>|<handle>` (`Site|L1`, nested `Outer|Inner|L1`) */
  id: string;
  /** the world-space entity; for xref entities a transformed copy whose handle is `id` and whose layer is the xref layer name */
  entity: Entity;
  /** the xref path (`Site`, `Outer|Inner`), null for model entities */
  xref: string | null;
  /** effective colour, linetype and lineweight after ByLayer / ByBlock inheritance */
  colour: ColourName;
  linetype: Linetype;
  lineweight: Lineweight;
  /** world bounding box [minX, minY, maxX, maxY]: insert = block extent, hatch = its boundary, dimension = refs + text */
  bounds: Rect;
  /** layer on and not frozen and (xref) meeting the clip: drawn, snapped, found, counted by ZOOMALL */
  visible: boolean;
  /** visible, layer not locked, not an xref entity: may be selected or picked */
  selectable: boolean;
  prims: readonly Prim[];
  clip: ClipRect | null;
  /** the block table that resolves this entity's inserts (an xref's own blocks for its entities) */
  blocks: Readonly<Record<string, BlockDef>>;
}

export interface Scene {
  /** entity list order: model entities by handle number, then xref entities in text order (own entities, then nested xrefs) */
  entities: readonly SceneEntity[];
  byId: ReadonlyMap<string, SceneEntity>;
  /** model layers in name order, then xref layers (`Site|Walls`) in text order */
  layers: readonly Layer[];
  dimStyles: Readonly<Record<string, DimStyle>>;
  clips: readonly ClipRect[];
  /** bounds of every visible entity, null when none */
  bounds: Rect | null;
  /** increases with every update, so a view can tell scenes apart */
  version: number;
}

/** A published `ModelSnapshot` as scene input. Snapshots do not store dimension styles: pass the drawing's, else only `Standard` is known. */
export function modelInput(model: ModelSnapshot, dimStyles: Readonly<Record<string, DimStyle>> = {}): SceneInput {
  return {
    layers: Object.fromEntries(model.layers.map((layer) => [layer.name, layer])),
    entities: Object.fromEntries(model.entities.map((entity) => [entity.handle, entity])),
    blocks: Object.fromEntries(model.blocks.map((block) => [block.name, block])),
    dim_styles: { Standard: STANDARD_DIM_STYLE, ...dimStyles },
    xrefs: Object.fromEntries(model.xrefs.map((xref) => [xref.name, xref])),
  };
}

const UNKNOWN_LAYER: Layer = { name: '0', colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false };

interface SceneState {
  input: SceneInput;
  byId: Map<string, SceneEntity>;
  /** model ids in entity list order */
  modelIds: string[];
  /** xref ids in text order */
  xrefIds: string[];
  xrefEntities: Map<string, Entity>;
  xrefLayers: Layer[];
  layerMap: Map<string, Layer>;
  layerList: Layer[];
  clips: Map<string, ClipRect>;
  index: GridIndex<SceneEntity>;
  /** target id -> dimensions and hatches that read it */
  dependents: Map<string, Set<string>>;
  dependencies: Map<string, string[]>;
  byLayer: Map<string, Set<string>>;
  modelInserts: Set<string>;
  dimensions: Set<string>;
  version: number;
}

const states = new WeakMap<Scene, SceneState>();

function sceneState(scene: Scene): SceneState {
  const state = states.get(scene);
  if (state === undefined) throw new Error('scene was not built by buildScene');
  return state;
}

export function layerOf(scene: Scene, name: string): Layer {
  return sceneState(scene).layerMap.get(name) ?? UNKNOWN_LAYER;
}

function targetsOf(entity: Entity): string[] {
  if (entity.type === 'dimension') return entity.refs.map((ref) => ref.handle);
  if (entity.type === 'hatch') return entity.boundary;
  return [];
}

function clipFor(state: SceneState, path: string, rect: Rect): ClipRect {
  const key = `${path}:${rect.join(',')}`;
  let clip = state.clips.get(key);
  if (clip === undefined) {
    clip = { id: `plot-clip-${state.clips.size}`, rect };
    state.clips.set(key, clip);
  }
  return clip;
}

function makeEntity(state: SceneState, entity: Entity, item: XrefItem | null): SceneEntity {
  const layer = state.layerMap.get(entity.layer) ?? UNKNOWN_LAYER;
  const blocks = item === null ? state.input.blocks : item.blocks;
  const { prims, bounds } = entityGeometry(entity, { blocks, lookup: (handle) => state.input.entities[handle] ?? state.xrefEntities.get(handle) });
  const clipRect = item === null ? null : item.clip;
  return {
    id: entity.handle,
    entity,
    xref: item === null ? null : item.path,
    colour: effectiveColour(entity.colour, layer),
    linetype: entity.linetype === undefined || entity.linetype === 'ByLayer' ? layer.linetype : entity.linetype,
    lineweight: entity.lineweight === undefined || entity.lineweight === 'ByLayer' ? layer.lineweight : entity.lineweight,
    bounds,
    visible: layer.on && !layer.frozen && (clipRect === null || rectsMeet(bounds, clipRect)),
    selectable: layer.on && !layer.frozen && !layer.locked && item === null,
    prims,
    clip: item === null || clipRect === null ? null : clipFor(state, item.path, clipRect),
    blocks,
  };
}

function register(state: SceneState, scene: SceneEntity): void {
  state.byId.set(scene.id, scene);
  if (scene.visible) state.index.insert(scene);
  const onLayer = state.byLayer.get(scene.entity.layer);
  if (onLayer === undefined) state.byLayer.set(scene.entity.layer, new Set([scene.id]));
  else onLayer.add(scene.id);
  if (scene.entity.type === 'insert' && scene.xref === null) state.modelInserts.add(scene.id);
  if (scene.entity.type === 'dimension') state.dimensions.add(scene.id);
  const targets = targetsOf(scene.entity);
  if (targets.length === 0) return;
  state.dependencies.set(scene.id, targets);
  for (const target of targets) {
    const users = state.dependents.get(target);
    if (users === undefined) state.dependents.set(target, new Set([scene.id]));
    else users.add(scene.id);
  }
}

function unregister(state: SceneState, id: string): void {
  const scene = state.byId.get(id);
  if (scene === undefined) return;
  state.byId.delete(id);
  if (scene.visible) state.index.remove(scene);
  state.byLayer.get(scene.entity.layer)?.delete(id);
  state.modelInserts.delete(id);
  state.dimensions.delete(id);
  for (const target of state.dependencies.get(id) ?? []) state.dependents.get(target)?.delete(id);
  state.dependencies.delete(id);
}

const byName = (a: Layer, b: Layer): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Flattens the input's xrefs into the state (their layers and ids) and returns the entities to make. */
function prepareXrefs(state: SceneState): XrefItem[] {
  const { items, layers } = flattenXrefs(state.input.xrefs);
  for (const layer of state.xrefLayers) state.layerMap.delete(layer.name);
  state.xrefLayers = layers;
  for (const layer of layers) state.layerMap.set(layer.name, layer);
  state.clips.clear();
  state.xrefEntities = new Map(items.map((item) => [item.entity.handle, item.entity]));
  state.xrefIds = items.map((item) => item.entity.handle);
  return items;
}

function refreshLayers(state: SceneState): void {
  state.layerList = [...Object.values(state.input.layers).sort(byName), ...state.xrefLayers];
}

function summarise(state: SceneState): Scene {
  const entities = [...state.modelIds, ...state.xrefIds].map((id) => state.byId.get(id)!);
  let bounds: Rect | null = null;
  for (const e of entities) if (e.visible) bounds = bounds === null ? e.bounds : unionRect(bounds, e.bounds);
  state.version += 1;
  const scene: Scene = {
    entities, byId: state.byId, layers: state.layerList, dimStyles: state.input.dim_styles,
    clips: [...state.clips.values()], bounds, version: state.version,
  };
  states.set(scene, state);
  return scene;
}

/** Builds the scene of a drawing state or published model: one SceneEntity per model entity, then per xref entity. */
export function buildScene(input: SceneInput): Scene {
  const state: SceneState = {
    input, byId: new Map(), modelIds: Object.keys(input.entities).sort(compareHandles), xrefIds: [], xrefEntities: new Map(), xrefLayers: [],
    layerMap: new Map(Object.entries(input.layers)), layerList: [], clips: new Map(), index: new GridIndex(1),
    dependents: new Map(), dependencies: new Map(), byLayer: new Map(), modelInserts: new Set(), dimensions: new Set(), version: 0,
  };
  const items = prepareXrefs(state);
  const made = [
    ...state.modelIds.map((id) => makeEntity(state, input.entities[id], null)),
    ...items.map((item) => makeEntity(state, item.entity, item)),
  ];
  state.index = new GridIndex(GridIndex.cellSizeFor(made));
  for (const scene of made) register(state, scene);
  refreshLayers(state);
  return summarise(state);
}

function changedKeys<V>(before: Readonly<Record<string, V>>, after: Readonly<Record<string, V>>): string[] {
  if (before === after) return [];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]);
}

function insertSorted(ids: string[], id: string): void {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (compareHandles(ids[mid], id) < 0) low = mid + 1;
    else high = mid;
  }
  ids.splice(low, 0, id);
}

function removeSorted(ids: string[], id: string): void {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (compareHandles(ids[mid], id) < 0) low = mid + 1;
    else high = mid;
  }
  if (ids[low] === id) ids.splice(low, 1);
}

/**
 * Incremental update by object identity: only entities (and the dimensions, hatches and inserts that depend on them) whose objects changed
 * are rebuilt. Takes ownership of `prev`: do not use `prev` afterwards, use the returned scene.
 */
export function updateScene(prev: Scene, input: SceneInput): Scene {
  const state = sceneState(prev);
  const before = state.input;
  state.input = input;

  const changedLayers = changedKeys(before.layers, input.layers);
  for (const name of changedLayers) {
    const layer = input.layers[name];
    if (layer === undefined) state.layerMap.delete(name);
    else state.layerMap.set(name, layer);
  }

  const touched = new Set<string>();
  for (const id of Object.keys(input.entities)) {
    const current = state.byId.get(id);
    if (current === undefined) insertSorted(state.modelIds, id);
    if (current === undefined || current.entity !== input.entities[id]) touched.add(id);
  }
  for (const id of [...state.modelIds]) {
    if (input.entities[id] !== undefined) continue;
    removeSorted(state.modelIds, id);
    touched.add(id);
  }

  const xrefsChanged = changedKeys(before.xrefs, input.xrefs).length > 0;
  const rebuilt = new Set<string>();
  if (xrefsChanged) {
    for (const id of state.xrefIds) unregister(state, id);
    for (const item of prepareXrefs(state)) {
      register(state, makeEntity(state, item.entity, item));
      rebuilt.add(item.entity.handle);
    }
  }
  const remake = (id: string, entity: Entity, item: XrefItem | null): void => {
    unregister(state, id);
    register(state, makeEntity(state, entity, item));
    rebuilt.add(id);
  };
  for (const id of touched) {
    const entity = input.entities[id];
    if (entity === undefined) unregister(state, id);
    else remake(id, entity, null);
  }

  const stale = new Set<string>();
  for (const id of touched) for (const user of state.dependents.get(id) ?? []) stale.add(user);
  for (const name of changedLayers) for (const id of state.byLayer.get(name) ?? []) stale.add(id);
  if (changedKeys(before.blocks, input.blocks).length > 0) for (const id of state.modelInserts) stale.add(id);
  if (changedKeys(before.dim_styles, input.dim_styles).length > 0) for (const id of state.dimensions) stale.add(id);
  for (const id of stale) {
    const current = state.byId.get(id);
    if (current === undefined || rebuilt.has(id)) continue;
    remake(id, current.entity, current.xref === null ? null : xrefItemOf(current));
  }
  if (changedLayers.length > 0 || xrefsChanged) refreshLayers(state);
  return summarise(state);
}

/** The xref meta of an existing scene entity, to rebuild it in place. */
function xrefItemOf(current: SceneEntity): XrefItem {
  return { entity: current.entity, path: current.xref!, blocks: current.blocks, clip: current.clip === null ? null : current.clip.rect };
}

/** Visible entities whose bounding box meets `rect` (grid index). */
export function queryRect(scene: Scene, rect: Rect): SceneEntity[] {
  return sceneState(scene).index.query(rect);
}

/** Entity list order: model entities by handle number, then xref entities in text order. */
export function listOrder(scene: Scene): (a: SceneEntity, b: SceneEntity) => number {
  const position = new Map(sceneState(scene).xrefIds.map((id, i) => [id, i]));
  return (a, b) => {
    if (a.xref === null || b.xref === null) return a.xref === b.xref ? compareHandles(a.id, b.id) : a.xref === null ? -1 : 1;
    return position.get(a.id)! - position.get(b.id)!;
  };
}

/** Find: handle (exact) or layer or block name, ignoring letter case; matches in entity list order. Skips entities on off or frozen layers. */
export function findEntities(scene: Scene, query: string): string[] {
  const wanted = query.toLowerCase();
  if (wanted === '') return [];
  return scene.entities
    .filter((e) => e.visible && (e.id.toLowerCase() === wanted || e.entity.layer.toLowerCase() === wanted || (e.entity.type === 'insert' && e.entity.block.toLowerCase() === wanted)))
    .map((e) => e.id);
}

/**
 * Large drawings: the entities that get a DOM element: bounding box meets the view grown by `marginPx` on every side, at most `ceiling`
 * nearest bounding-box centre to view centre first, plus every entity in `selected`. Returned in entity list order.
 */
export function domEntities(scene: Scene, view: View, pane: Size, marginPx: number, ceiling: number, selected: ReadonlySet<string>): SceneEntity[] {
  const grow = marginPx / view.zoom;
  const [x1, y1, x2, y2] = viewWorldRect(view, pane);
  const centre = midpoint([x1, y1], [x2, y2]);
  const gap = (e: SceneEntity): number => distance(midpoint([e.bounds[0], e.bounds[1]], [e.bounds[2], e.bounds[3]]), centre);
  const nearest = queryRect(scene, [x1 - grow, y1 - grow, x2 + grow, y2 + grow])
    .map((e) => ({ e, gap: gap(e) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, ceiling)
    .map(({ e }) => e);
  const kept = new Set(nearest);
  for (const id of selected) {
    const e = scene.byId.get(id);
    if (e?.visible === true) kept.add(e);
  }
  return [...kept].sort(listOrder(scene));
}
