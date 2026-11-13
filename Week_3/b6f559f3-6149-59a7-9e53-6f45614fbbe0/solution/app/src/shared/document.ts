/**
 * The scene document: complete defaults, and the one place that applies a change to it.
 * The server applies changes with this module; the editor applies the same changes locally.
 */
import { bindingPaths, boundValue } from './bindings';
import { SPRING_DEFAULTS } from './easing';
import { COLOUR_PATTERN, framesIn, normaliseColour, roundTo } from './format';
import { fontRefusal } from './geometry';
import {
  differsByBreakpoint,
  layerHeld,
  layerLocked,
  MESSAGES,
  mustBeBetween,
  variableExists,
} from './messages';
import { clone, getPath, isObject, setPath } from './paths';
import {
  CLIP_OFFSET,
  CLIP_SPEED,
  defaultEvents,
  defaultOf,
  defaultProps,
  findLayerDefinition,
  findSceneDefinition,
  GLASS_DEFAULTS,
  layerDefinitions,
  MATCAP_DEFAULTS,
  type PropertyDef,
} from './properties';
import {
  BLEND_MODES,
  BREAKPOINTS,
  EASING_NAMES,
  LAYER_KINDS,
  type AssetInfo,
  type Change,
  type Easing,
  type Json,
  type JsonObject,
  type Layer,
  type LayerKind,
  type Preset,
  type Scene,
  type SceneDocument,
  type SceneFields,
  type Seeds,
  type Variable,
  type VariableType,
  type VariableValue,
  SCHEMA_VERSION,
  VARIABLE_TYPES,
} from './types';

const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const VARIABLE_NUMBER_LIMIT = 1_000_000;
const NAME_LIMIT = 60;
const TEXT_LIMIT = 200;
export const SPRING_LIMITS = {
  stiffness: { min: 1, max: 1000 },
  damping: { min: 0, max: 100 },
  mass: { min: 0.1, max: 10 },
} as const;

export interface DocumentContext {
  seeds: Seeds;
  newId: () => string;
  /** The status of an asset of this project, or undefined when the project has no such asset. */
  assetStatus: (assetId: string) => AssetInfo['status'] | undefined;
}

export interface Refusal {
  status: 409 | 422;
  code: 'validation' | 'layer_locked' | 'layer_held';
  message: string;
  errors: Record<string, string>;
}

export interface Touched {
  /** Layers written (added or changed), with their scene. */
  layers: Map<string, string>;
  /** Layers removed, with their scene. */
  removed: Map<string, string>;
  scenes: Set<string>;
  variables: boolean;
  presets: boolean;
}

/** The state after a change, in the shape the live channel and the editor merge. */
export interface Patch {
  scenes: SceneFields[];
  layers: { sceneId: string; layer: Layer }[];
  removed: { sceneId: string; layerId: string }[];
  variables: Variable[] | null;
  presets: Preset[] | null;
}

type Outcome = { ok: true; document: SceneDocument; ids: Record<string, string>; touched: Touched } | { ok: false; refusal: Refusal };

const refuse = (path: string, message: string): Outcome => ({
  ok: false,
  refusal: { status: 422, code: 'validation', message, errors: { [path]: message } },
});

class Invalid extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (path: string, message: string): never => {
  throw new Invalid(path, message);
};

// ---------------------------------------------------------------- completion

function defaultLayerName(kind: LayerKind, props: JsonObject): string {
  if (kind === 'Primitive') {
    const primitive = props['primitive'];
    return typeof primitive === 'string' ? primitive : 'Cube';
  }
  if (kind === 'Effect') {
    const effect = props['effect'];
    return isObject(effect) && typeof effect['kind'] === 'string' ? effect['kind'] : 'Blur';
  }
  if (kind === 'Extrusion') return props['source'] === 'svg' ? 'Extruded SVG' : 'Extruded text';
  if (kind === 'Model') return typeof props['preset'] === 'string' ? props['preset'] : 'Model';
  return kind;
}

/** The first free name of the form `Torus`, `Torus 2`, `Torus 3` in a scene. */
function numberedName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}

function mergeEvents(given: JsonObject, seeds: Seeds): JsonObject {
  const events = defaultEvents(seeds);
  const merge = (target: JsonObject, source: JsonObject): void => {
    for (const [key, value] of Object.entries(source)) {
      const own = target[key];
      if (isObject(value) && isObject(own) && Object.keys(own).length > 0 && !['from', 'to'].includes(key)) merge(own, value);
      else target[key] = clone(value);
    }
  };
  merge(events, given);
  return events;
}

export interface LayerDraft extends Partial<Omit<Layer, 'kind'>> {
  kind: LayerKind;
}

/** A layer with every default filled in. `id` must be given. */
function completeLayer(draft: LayerDraft, seeds: Seeds): Layer {
  const props = draft.kind === 'Group' ? {} : defaultProps(draft.kind, seeds, draft.props ?? {});
  const overrides = draft.overrides ?? { tablet: {}, mobile: {} };
  return {
    id: draft.id ?? '',
    name: draft.name ?? defaultLayerName(draft.kind, props),
    kind: draft.kind,
    parentId: draft.parentId ?? null,
    order: draft.order ?? 0,
    visible: draft.visible ?? true,
    locked: draft.locked ?? false,
    maskAbove: draft.maskAbove ?? false,
    blendMode: draft.blendMode ?? 'Normal',
    props,
    overrides: { tablet: { ...(overrides.tablet ?? {}) }, mobile: { ...(overrides.mobile ?? {}) } },
    keyframes: (draft.keyframes ?? []).map((k) => ({ ...k, easing: k.easing ?? 'linear' })),
    events: draft.kind === 'Group' ? {} : mergeEvents(draft.events ?? {}, seeds),
    bindings: { ...(draft.bindings ?? {}) },
  };
}

export type SceneDraft = Partial<Omit<Scene, 'layers'>> & { id: string; name: string; layers: LayerDraft[] };

function completeScene(draft: SceneDraft, seeds: Seeds): Scene {
  const defaults = (path: string): Json => defaultOf(findSceneDefinition(path) as PropertyDef, seeds);
  const camera = draft.camera;
  const vec = (given: Partial<{ x: number; y: number; z: number }> | undefined, path: string) => ({
    x: given?.x ?? (defaults(`${path}.x`) as number),
    y: given?.y ?? (defaults(`${path}.y`) as number),
    z: given?.z ?? (defaults(`${path}.z`) as number),
  });
  return {
    id: draft.id,
    name: draft.name,
    background: draft.background ?? (defaults('background') as string),
    environment: draft.environment ?? (defaults('environment') as Scene['environment']),
    durationMs: draft.durationMs ?? (defaults('durationMs') as number),
    camera: {
      fov: camera?.fov ?? (defaults('camera.fov') as number),
      position: vec(camera?.position, 'camera.position'),
      target: vec(camera?.target, 'camera.target'),
      near: camera?.near ?? (defaults('camera.near') as number),
      far: camera?.far ?? (defaults('camera.far') as number),
    },
    orbit: {
      enabled: draft.orbit?.enabled ?? (defaults('orbit.enabled') as boolean),
      startAngle: draft.orbit?.startAngle ?? (defaults('orbit.startAngle') as number),
      endAngle: draft.orbit?.endAngle ?? (defaults('orbit.endAngle') as number),
    },
    light: {
      enabled: draft.light?.enabled ?? (defaults('light.enabled') as boolean),
      sensitivity: draft.light?.sensitivity ?? (defaults('light.sensitivity') as number),
      momentum: draft.light?.momentum ?? (defaults('light.momentum') as number),
    },
    overrides: {
      tablet: { ...(draft.overrides?.tablet ?? {}) },
      mobile: { ...(draft.overrides?.mobile ?? {}) },
    },
    layers: draft.layers.map((layer) => completeLayer(layer, seeds)),
  };
}

export interface DocumentDraft {
  name: string;
  variables?: Variable[];
  presets?: Preset[];
  scenes: SceneDraft[];
}

/** The complete working document: every default filled in. Exports serialise this as stored. */
export function completeDocument(draft: DocumentDraft, seeds: Seeds): SceneDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: draft.name,
    variables: (draft.variables ?? []).map((v) => clone(v)),
    presets: (draft.presets ?? []).map((p) => clone(p)),
    scenes: draft.scenes.map((scene) => completeScene(scene, seeds)),
  };
}

// ---------------------------------------------------------------- lookups

export const findScene = (doc: SceneDocument, sceneId: string): Scene | undefined => doc.scenes.find((s) => s.id === sceneId);

export function findLayer(doc: SceneDocument, layerId: string): { scene: Scene; layer: Layer } | undefined {
  for (const scene of doc.scenes) {
    const layer = scene.layers.find((l) => l.id === layerId);
    if (layer) return { scene, layer };
  }
  return undefined;
}

/** Children of `parentId` in stack order, bottom first. */
export function siblings(scene: Scene, parentId: string | null): Layer[] {
  return scene.layers.filter((l) => l.parentId === parentId).sort((a, b) => a.order - b.order);
}

function renumber(scene: Scene, parentId: string | null): void {
  siblings(scene, parentId).forEach((layer, index) => {
    layer.order = index;
  });
}

export function descendants(scene: Scene, groupId: string): Layer[] {
  const out: Layer[] = [];
  for (const child of scene.layers.filter((l) => l.parentId === groupId)) out.push(child, ...descendants(scene, child.id));
  return out;
}

/** The layer ids a change writes, for lock checks. Unknown ids are included; validation refuses them later. */
export function changeLayerIds(change: Change): string[] {
  switch (change.type) {
    case 'updateLayer':
    case 'clearOverride':
    case 'deleteLayer':
    case 'moveLayer':
    case 'duplicateLayer':
    case 'setKeyframe':
    case 'moveKeyframe':
    case 'deleteKeyframe':
    case 'bind':
    case 'unbind':
      return [change.layerId];
    case 'group':
      return change.layerIds;
    case 'ungroup':
      return [change.groupId];
    default:
      return [];
  }
}

/** Unlocking a layer is the one edit a locked layer accepts. */
const isLockToggle = (change: Change): boolean =>
  change.type === 'updateLayer' && Object.keys(change.set).length > 0 && Object.keys(change.set).every((key) => key === 'locked');

/** The first lock refusal for a change set: a locked layer, or a layer held by another person. */
export const heldRefusal = (holder: string): Refusal => ({ status: 409, code: 'layer_held', message: layerHeld(holder), errors: {} });
export const lockedRefusal = (layerName: string): Refusal => ({ status: 409, code: 'layer_locked', message: layerLocked(layerName), errors: {} });

export function lockRefusal(
  doc: SceneDocument,
  changes: readonly Change[],
  heldBy: (layerId: string) => string | null,
): Refusal | null {
  for (const change of changes) {
    for (const id of changeLayerIds(change)) {
      const found = findLayer(doc, id);
      if (!found) continue;
      const holder = heldBy(id);
      if (holder) return heldRefusal(holder);
      if (found.layer.locked && !isLockToggle(change)) return lockedRefusal(found.layer.name);
    }
  }
  return null;
}

// ---------------------------------------------------------------- value checks

/** The refusal text for a value that does not fit its definition, or null when it fits. */
export function checkValue(def: PropertyDef, value: Json | undefined): string | null {
  switch (def.control) {
    case 'spin':
      if (typeof value !== 'number' || !Number.isFinite(value)) return MESSAGES.invalidValue;
      if (value < (def.min as number) || value > (def.max as number)) return mustBeBetween(def.min as number, def.max as number);
      if (def.integer && !Number.isInteger(value)) return MESSAGES.invalidValue;
      return null;
    case 'colour':
      return typeof value === 'string' && COLOUR_PATTERN.test(value) ? null : MESSAGES.colour;
    case 'switch':
      return typeof value === 'boolean' ? null : MESSAGES.invalidValue;
    case 'select':
    case 'radio':
      if (typeof value === 'string' && def.choices?.some((c) => c.value === value)) return null;
      return def.path.endsWith('easing') ? MESSAGES.easing : MESSAGES.invalidValue;
    case 'text':
      if (typeof value !== 'string') return MESSAGES.invalidValue;
      if (def.path === 'name') {
        if (value.trim().length === 0) return MESSAGES.enterName;
        return value.length > NAME_LIMIT ? mustBeBetween(1, NAME_LIMIT) : null;
      }
      if (value.length > (def.maxLength ?? TEXT_LIMIT)) return mustBeBetween(0, def.maxLength ?? TEXT_LIMIT);
      return def.path === 'text' && def.label === 'Extrude text' ? fontRefusal(value) : null;
    case 'custom':
      return null;
  }
}

function checkEasing(value: Json | undefined, allowSpring: boolean): string | null {
  if (typeof value === 'string') return (EASING_NAMES as readonly string[]).includes(value) ? null : MESSAGES.easing;
  if (allowSpring && isObject(value) && value['type'] === 'spring') {
    for (const key of ['stiffness', 'damping', 'mass'] as const) {
      const n = value[key];
      const limits = SPRING_LIMITS[key];
      if (typeof n !== 'number' || n < limits.min || n > limits.max) return mustBeBetween(limits.min, limits.max);
    }
    return null;
  }
  return MESSAGES.easing;
}

function normaliseEasing(value: Json): Easing {
  if (typeof value === 'string') return value as Easing;
  const spring = value as JsonObject;
  return {
    type: 'spring',
    stiffness: (spring['stiffness'] as number | undefined) ?? SPRING_DEFAULTS.stiffness,
    damping: (spring['damping'] as number | undefined) ?? SPRING_DEFAULTS.damping,
    mass: (spring['mass'] as number | undefined) ?? SPRING_DEFAULTS.mass,
  };
}

function checkStops(value: Json | undefined): string | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return MESSAGES.gradientStops;
  for (const stop of value) {
    if (!isObject(stop) || typeof stop['color'] !== 'string' || !COLOUR_PATTERN.test(stop['color'])) return MESSAGES.colour;
    const position = stop['position'];
    if (typeof position !== 'number' || position < 0 || position > 100) return mustBeBetween(0, 100);
  }
  return null;
}

function checkClips(value: Json | undefined): string | null {
  if (!Array.isArray(value)) return MESSAGES.invalidValue;
  for (const clip of value) {
    if (!isObject(clip) || typeof clip['name'] !== 'string') return MESSAGES.invalidValue;
    if (typeof clip['play'] !== 'boolean' || typeof clip['loop'] !== 'boolean') return MESSAGES.invalidValue;
    const speed = clip['speed'];
    if (typeof speed !== 'number' || speed < CLIP_SPEED.min || speed > CLIP_SPEED.max) return mustBeBetween(CLIP_SPEED.min, CLIP_SPEED.max);
    const offset = clip['offsetMs'];
    if (typeof offset !== 'number' || offset < CLIP_OFFSET.min || offset > CLIP_OFFSET.max) return mustBeBetween(CLIP_OFFSET.min, CLIP_OFFSET.max);
  }
  return null;
}

const ASSET_PATHS = ['assetId', 'svgAssetId', 'modelAssetId'];

/** Validates a value for a layer definition, including the custom fields. Returns the value to store. */
function accept(layer: Pick<Layer, 'kind' | 'props'>, def: PropertyDef, value: Json, ctx: DocumentContext, errorPath: string): Json {
  let problem: string | null;
  if (def.control === 'custom') {
    problem = null;
    if (def.path === 'gradient.stops') problem = checkStops(value);
    else if (def.path === 'clips') problem = checkClips(value);
    else if (ASSET_PATHS.includes(def.path)) {
      if (value !== null) problem = typeof value === 'string' && ctx.assetStatus(value) === 'confirmed' ? null : MESSAGES.uploadNotReady;
    } else if (def.path === 'formation.target') problem = value === null || typeof value === 'string' ? null : MESSAGES.invalidValue;
    else if (def.path === 'preset') problem = value === null || typeof value === 'string' ? null : MESSAGES.invalidValue;
    else if (def.path.endsWith('.from') || def.path.endsWith('.to')) problem = checkTargets(layer, value);
  } else {
    problem = checkValue(def, value);
  }
  if (problem) fail(errorPath, problem);
  if (def.control === 'spin') return def.integer ? (value as number) : roundTo(value as number, 3);
  if (def.control === 'colour') return normaliseColour(value as string);
  if (def.path === 'gradient.stops') {
    return (value as JsonObject[]).map((stop) => ({ color: normaliseColour(stop['color'] as string), position: stop['position'] as number }));
  }
  return value;
}

function checkTargets(layer: Pick<Layer, 'kind' | 'props'>, value: Json): string | null {
  if (!isObject(value)) return MESSAGES.invalidValue;
  for (const [path, v] of Object.entries(value)) {
    const def = findLayerDefinition(layer, path);
    if (!def || def.control !== 'spin') return MESSAGES.unknownField;
    const problem = checkValue(def, v);
    if (problem) return problem;
  }
  return null;
}

/** Expands `{"events.appear": {...}}` into the leaf definitions it covers. */
function expand(layer: Pick<Layer, 'kind' | 'props'>, path: string, value: Json): [PropertyDef, Json, string][] {
  const def = findLayerDefinition(layer, path);
  if (def) return [[def, value, path]];
  if (isObject(value) && Object.keys(value).length > 0) return Object.entries(value).flatMap(([key, child]) => expand(layer, `${path}.${key}`, child));
  return fail(path, MESSAGES.unknownField);
}

function writeValue(layer: Layer, path: string, value: Json): void {
  if (path === 'name') layer.name = value as string;
  else if (path === 'visible') layer.visible = value as boolean;
  else if (path === 'locked') layer.locked = value as boolean;
  else if (path === 'maskAbove') layer.maskAbove = value as boolean;
  else if (path === 'blendMode') layer.blendMode = value as Layer['blendMode'];
  else if (path.startsWith('events.')) setPath(layer.events, path.slice('events.'.length), value);
  else setPath(layer.props, path, value);
}

function readValue(layer: Layer, path: string): Json | undefined {
  if (path === 'visible') return layer.visible;
  if (path.startsWith('events.')) return getPath(layer.events, path.slice('events.'.length));
  return getPath(layer.props, path);
}

// ---------------------------------------------------------------- applying changes

interface Work {
  doc: SceneDocument;
  scene: Scene;
  ctx: DocumentContext;
  ids: Record<string, string>;
  touched: Touched;
}

function touchLayer(work: Work, scene: Scene, layer: Layer): void {
  work.touched.layers.set(layer.id, scene.id);
  work.touched.removed.delete(layer.id);
}

function getLayer(work: Work, layerId: string, path = 'layerId'): { scene: Scene; layer: Layer } {
  const found = findLayer(work.doc, layerId);
  if (!found || found.scene.id !== work.scene.id) return fail(path, MESSAGES.unknownLayer);
  return found;
}

function removeLayers(work: Work, scene: Scene, removed: readonly Layer[]): void {
  const ids = new Set(removed.map((l) => l.id));
  scene.layers = scene.layers.filter((l) => !ids.has(l.id));
  for (const layer of removed) {
    work.touched.removed.set(layer.id, scene.id);
    work.touched.layers.delete(layer.id);
  }
}

/** The override level a breakpoint writes to (null for desktop); anything outside the three breakpoints is refused. */
function levelOf(breakpoint: unknown): 'tablet' | 'mobile' | null {
  if (typeof breakpoint !== 'string' || !(BREAKPOINTS as readonly string[]).includes(breakpoint)) return fail('breakpoint', MESSAGES.invalidValue);
  return breakpoint === 'desktop' ? null : (breakpoint as 'tablet' | 'mobile');
}

function updateLayer(work: Work, change: Extract<Change, { type: 'updateLayer' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const level = levelOf(change.breakpoint);
  const entries: [PropertyDef, Json, string][] = [];
  for (const [path, value] of Object.entries(change.set)) entries.push(...expand(layer, path, value));
  const accepted = new Map<string, Json>();
  for (const [def, value, path] of entries) {
    if (level && !def.overridable) fail(path, differsByBreakpoint(def.label));
    accepted.set(def.path, accept(layer, def, value, work.ctx, path));
  }
  const kind = accepted.get('material.kind');
  if (kind !== undefined && kind !== readValue(layer, 'material.kind')) {
    const defaults = kind === 'Glass' ? GLASS_DEFAULTS : MATCAP_DEFAULTS;
    if (!accepted.has('material.color')) accepted.set('material.color', defaults.color);
    if (!accepted.has('material.opacity')) accepted.set('material.opacity', defaults.opacity);
  }
  for (const [path, value] of accepted) {
    if (level) layer.overrides[level][path] = value;
    else writeValue(layer, path, value);
  }
  touchLayer(work, scene, layer);
}

function clearOverride(work: Work, change: Extract<Change, { type: 'clearOverride' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const level = levelOf(change.breakpoint);
  if (!level) fail('breakpoint', MESSAGES.invalidValue);
  else delete layer.overrides[level][change.path];
  touchLayer(work, scene, layer);
}

function addLayer(work: Work, change: Extract<Change, { type: 'addLayer' }>): void {
  const draft = change.layer;
  if (!isObject(draft as unknown as Json)) return fail('layer', MESSAGES.invalidValue);
  if (draft.props !== undefined && !isObject(draft.props as Json)) return fail('layer.props', MESSAGES.invalidValue);
  if (typeof change.ref !== 'string') return fail('ref', MESSAGES.invalidValue);
  if (!(LAYER_KINDS as readonly string[]).includes(draft.kind)) fail('layer.kind', MESSAGES.invalidValue);
  const props: JsonObject = {};
  for (const [path, value] of Object.entries(draft.props ?? {})) setPath(props, path, value);
  const probe = { kind: draft.kind, props: defaultProps(draft.kind, work.ctx.seeds, props) };
  for (const [def, value, path] of Object.entries(props).flatMap(([k, v]) => expand(probe, k, v))) {
    accept(probe, def, value, work.ctx, ASSET_PATHS.includes(def.path) ? 'layer.assetId' : `layer.props.${path}`);
  }
  if (draft.name !== undefined) {
    const problem = checkValue(findLayerDefinition(probe, 'name') ?? layerDefinitions(probe)[0]!, draft.name);
    if (problem) fail('layer.name', problem);
  }
  if (draft.blendMode !== undefined && !(BLEND_MODES as readonly string[]).includes(draft.blendMode)) fail('layer.blendMode', MESSAGES.invalidValue);
  const parentId = draft.parentId ?? null;
  if (parentId !== null && work.scene.layers.find((l) => l.id === parentId)?.kind !== 'Group') fail('layer.parentId', MESSAGES.unknownLayer);
  const base = defaultLayerName(draft.kind, probe.props);
  const layer = completeLayer(
    {
      ...draft,
      id: work.ctx.newId(),
      name: draft.name ?? numberedName(base, work.scene.layers.map((l) => l.name)),
      parentId,
      order: siblings(work.scene, parentId).length,
      keyframes: [],
      overrides: { tablet: {}, mobile: {} },
      bindings: {},
    },
    work.ctx.seeds,
  );
  work.scene.layers.push(layer);
  work.ids[change.ref] = layer.id;
  touchLayer(work, work.scene, layer);
}

function moveLayer(work: Work, change: Extract<Change, { type: 'moveLayer' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  if (change.parentId !== null) {
    const parent = scene.layers.find((l) => l.id === change.parentId);
    if (parent?.kind !== 'Group') fail('parentId', MESSAGES.unknownLayer);
    if (change.parentId === layer.id || descendants(scene, layer.id).some((d) => d.id === change.parentId)) fail('parentId', MESSAGES.invalidValue);
  }
  if (!Number.isInteger(change.order) || change.order < 0) fail('order', MESSAGES.invalidValue);
  const oldParent = layer.parentId;
  const list = siblings(scene, change.parentId).filter((l) => l.id !== layer.id);
  list.splice(Math.min(change.order, list.length), 0, layer);
  layer.parentId = change.parentId;
  list.forEach((l, i) => {
    l.order = i;
    touchLayer(work, scene, l);
  });
  if (oldParent !== change.parentId) {
    renumber(scene, oldParent);
    siblings(scene, oldParent).forEach((l) => touchLayer(work, scene, l));
  }
}

function copyLayer(work: Work, scene: Scene, source: Layer, parentId: string | null, order: number, names: string[]): Layer {
  const copy = clone(source);
  copy.id = work.ctx.newId();
  copy.parentId = parentId;
  copy.order = order;
  copy.name = numberedName(source.name.replace(/ \d+$/, ''), names);
  names.push(copy.name);
  scene.layers.push(copy);
  touchLayer(work, scene, copy);
  for (const child of siblings(scene, source.id)) copyLayer(work, scene, child, copy.id, child.order, names);
  return copy;
}

function duplicateLayer(work: Work, change: Extract<Change, { type: 'duplicateLayer' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const above = siblings(scene, layer.parentId).filter((l) => l.order > layer.order);
  for (const l of above) {
    l.order += 1;
    touchLayer(work, scene, l);
  }
  const names = scene.layers.map((l) => l.name);
  const copy = copyLayer(work, scene, layer, layer.parentId, layer.order + 1, names);
  work.ids[`duplicate:${layer.id}`] = copy.id;
}

function group(work: Work, change: Extract<Change, { type: 'group' }>): void {
  if (!Array.isArray(change.layerIds) || change.layerIds.length === 0 || change.layerIds.some((id) => typeof id !== 'string')) {
    fail('layerIds', MESSAGES.invalidValue);
  }
  const members = change.layerIds.map((id) => getLayer(work, id, 'layerIds').layer);
  const scene = work.scene;
  const parentId = members[0]!.parentId;
  if (members.some((m) => m.parentId !== parentId)) fail('layerIds', MESSAGES.invalidValue);
  const ordered = [...members].sort((a, b) => a.order - b.order);
  const top = ordered[ordered.length - 1]!;
  const names = scene.layers.map((l) => l.name);
  const container = completeLayer(
    { kind: 'Group', id: work.ctx.newId(), name: numberedName('Group', names), parentId, order: top.order },
    work.ctx.seeds,
  );
  scene.layers.push(container);
  ordered.forEach((member, index) => {
    member.parentId = container.id;
    member.order = index;
    touchLayer(work, scene, member);
  });
  const rest = siblings(scene, parentId).filter((l) => l.id !== container.id);
  const final = [...rest.filter((l) => l.order < top.order), container, ...rest.filter((l) => l.order >= top.order)];
  final.forEach((l, i) => {
    l.order = i;
    touchLayer(work, scene, l);
  });
  work.ids[`group:${top.id}`] = container.id;
}

function ungroup(work: Work, change: Extract<Change, { type: 'ungroup' }>): void {
  const { scene, layer: container } = getLayer(work, change.groupId, 'groupId');
  if (container.kind !== 'Group') fail('groupId', MESSAGES.invalidValue);
  const children = siblings(scene, container.id);
  const parentList = siblings(scene, container.parentId);
  const at = parentList.findIndex((l) => l.id === container.id);
  parentList.splice(at, 1, ...children);
  for (const child of children) child.parentId = container.parentId;
  parentList.forEach((l, i) => {
    l.order = i;
    touchLayer(work, scene, l);
  });
  removeLayers(work, scene, [container]);
}

function deleteLayer(work: Work, change: Extract<Change, { type: 'deleteLayer' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const parentId = layer.parentId;
  removeLayers(work, scene, [layer, ...descendants(scene, layer.id)]);
  renumber(scene, parentId);
  siblings(scene, parentId).forEach((l) => touchLayer(work, scene, l));
}

function keyframeFor(layer: Layer, property: string): PropertyDef {
  const def = findLayerDefinition(layer, property);
  if (!def || !def.keyframeable) return fail('property', MESSAGES.unknownField);
  return def;
}

function checkFrame(work: Work, frame: number, path: string): void {
  const last = framesIn(work.scene.durationMs);
  if (!Number.isInteger(frame) || frame < 0 || frame > last) fail(path, mustBeBetween(0, last));
}

function setKeyframe(work: Work, change: Extract<Change, { type: 'setKeyframe' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const def = keyframeFor(layer, change.property);
  checkFrame(work, change.frame, 'frame');
  const problem = checkValue(def, change.value);
  if (problem) fail('value', problem);
  const easingProblem = checkEasing(change.easing as Json, true);
  if (easingProblem) fail('easing', easingProblem);
  layer.keyframes = layer.keyframes.filter((k) => !(k.property === change.property && k.frame === change.frame));
  layer.keyframes.push({
    property: change.property,
    frame: change.frame,
    value: roundTo(change.value, 3),
    easing: normaliseEasing(change.easing as Json),
  });
  touchLayer(work, scene, layer);
}

function moveKeyframe(work: Work, change: Extract<Change, { type: 'moveKeyframe' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const moving = layer.keyframes.find((k) => k.property === change.property && k.frame === change.fromFrame);
  if (!moving) return fail('fromFrame', MESSAGES.invalidValue);
  checkFrame(work, change.toFrame, 'toFrame');
  layer.keyframes = layer.keyframes.filter((k) => k === moving || !(k.property === change.property && k.frame === change.toFrame));
  moving.frame = change.toFrame;
  touchLayer(work, scene, layer);
}

function deleteKeyframe(work: Work, change: Extract<Change, { type: 'deleteKeyframe' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const before = layer.keyframes.length;
  layer.keyframes = layer.keyframes.filter((k) => !(k.property === change.property && k.frame === change.frame));
  if (layer.keyframes.length === before) fail('frame', MESSAGES.invalidValue);
  touchLayer(work, scene, layer);
}

function updateScene(work: Work, change: Extract<Change, { type: 'updateScene' }>): void {
  const level = levelOf(change.breakpoint);
  for (const [path, value] of Object.entries(change.set)) {
    const def = findSceneDefinition(path);
    if (!def) fail(path, MESSAGES.unknownField);
    else {
      if (level && !def.overridable) fail(path, differsByBreakpoint(def.label));
      const problem = checkValue(def, value);
      if (problem) fail(path, problem);
      const stored = def.control === 'spin' ? roundTo(value as number, 3) : def.control === 'colour' ? normaliseColour(value as string) : value;
      if (level) work.scene.overrides[level][path] = stored;
      else setPath(work.scene as unknown as JsonObject, path, stored);
    }
  }
  work.touched.scenes.add(work.scene.id);
}

function checkVariableValue(type: VariableType, value: Json | undefined): string | null {
  const number = (n: Json | undefined): boolean => typeof n === 'number' && Number.isFinite(n);
  const inRange = (n: Json | undefined): boolean => number(n) && Math.abs(n as number) <= VARIABLE_NUMBER_LIMIT;
  const range = mustBeBetween(-VARIABLE_NUMBER_LIMIT, VARIABLE_NUMBER_LIMIT);
  switch (type) {
    case 'Number':
      return !number(value) ? MESSAGES.invalidValue : inRange(value) ? null : range;
    case 'Boolean':
      return typeof value === 'boolean' ? null : MESSAGES.invalidValue;
    case 'Text':
      if (typeof value !== 'string') return MESSAGES.invalidValue;
      return value.length > TEXT_LIMIT ? mustBeBetween(0, TEXT_LIMIT) : null;
    case 'Colour':
      return typeof value === 'string' && COLOUR_PATTERN.test(value) ? null : MESSAGES.colour;
    case 'Vector 2':
    case 'Vector 3': {
      if (!isObject(value)) return MESSAGES.invalidValue;
      const axes = type === 'Vector 2' ? ['x', 'y'] : ['x', 'y', 'z'];
      if (!axes.every((a) => number(value[a]))) return MESSAGES.invalidValue;
      return axes.every((a) => inRange(value[a])) ? null : range;
    }
  }
}

function storedVariable(type: VariableType, value: Json): VariableValue {
  if (type === 'Number') return roundTo(value as number, 3);
  if (type === 'Colour') return normaliseColour(value as string);
  if (type === 'Vector 2' || type === 'Vector 3') {
    const v = value as JsonObject;
    const out: Record<string, number> = { x: roundTo(v['x'] as number, 3), y: roundTo(v['y'] as number, 3) };
    if (type === 'Vector 3') out['z'] = roundTo(v['z'] as number, 3);
    return out as unknown as VariableValue;
  }
  return value as VariableValue;
}

const findVariable = (work: Work, name: string, path = 'name'): Variable => {
  const variable = work.doc.variables.find((v) => v.name === name);
  return variable ?? fail(path, MESSAGES.unknownVariable);
};

function addVariable(work: Work, change: Extract<Change, { type: 'addVariable' }>): void {
  const { name, type, value } = change.variable;
  if (typeof name !== 'string' || !VARIABLE_NAME.test(name)) fail('variable.name', MESSAGES.variableName);
  if (work.doc.variables.some((v) => v.name === name)) fail('variable.name', variableExists(name));
  if (!(VARIABLE_TYPES as readonly string[]).includes(type)) fail('variable.type', MESSAGES.invalidValue);
  const problem = checkVariableValue(type, value as Json);
  if (problem) fail('variable.value', problem);
  work.doc.variables.push({ name, type, value: storedVariable(type, value as Json) });
  work.touched.variables = true;
}

function updateVariable(work: Work, change: Extract<Change, { type: 'updateVariable' }>): void {
  const variable = findVariable(work, change.name);
  const problem = checkVariableValue(variable.type, change.value as Json);
  if (problem) fail('value', problem);
  variable.value = storedVariable(variable.type, change.value as Json);
  work.touched.variables = true;
}

/** The number of bindings that point at a variable, across every scene. */
export function bindingCount(doc: SceneDocument, name: string): number {
  return doc.scenes.reduce(
    (sum, scene) => sum + scene.layers.reduce((n, l) => n + Object.values(l.bindings).filter((bound) => bound === name).length, 0),
    0,
  );
}

function deleteVariable(work: Work, change: Extract<Change, { type: 'deleteVariable' }>): void {
  const variable = findVariable(work, change.name);
  for (const scene of work.doc.scenes) {
    for (const layer of scene.layers) {
      for (const [property, bound] of Object.entries(layer.bindings)) {
        if (bound !== change.name) continue;
        const paths = bindingPaths(layer, property, variable.type);
        if (typeof paths !== 'string') {
          for (const path of paths) {
            const { value } = boundValue(findLayerDefinition(layer, path), variable.type, variable.value, path);
            writeValue(layer, path, value);
          }
        }
        delete layer.bindings[property];
        touchLayer(work, scene, layer);
      }
    }
  }
  work.doc.variables = work.doc.variables.filter((v) => v.name !== change.name);
  for (const preset of work.doc.presets) delete preset.values[change.name];
  work.touched.variables = true;
  work.touched.presets = true;
}

function bind(work: Work, change: Extract<Change, { type: 'bind' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  const variable = findVariable(work, change.variable, 'variable');
  const paths = bindingPaths(layer, change.property, variable.type);
  if (typeof paths === 'string') fail('property', paths);
  layer.bindings[change.property] = variable.name;
  touchLayer(work, scene, layer);
}

function unbind(work: Work, change: Extract<Change, { type: 'unbind' }>): void {
  const { scene, layer } = getLayer(work, change.layerId);
  if (!(change.property in layer.bindings)) fail('property', MESSAGES.unknownField);
  delete layer.bindings[change.property];
  touchLayer(work, scene, layer);
}

function presetName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) return fail('name', MESSAGES.enterName);
  if (name.length > NAME_LIMIT) return fail('name', mustBeBetween(1, NAME_LIMIT));
  return name;
}

function savePreset(work: Work, change: Extract<Change, { type: 'savePreset' }>): void {
  const name = presetName(change.name);
  const values: Record<string, VariableValue> = {};
  for (const variable of work.doc.variables) values[variable.name] = clone(variable.value as unknown as JsonObject) as unknown as VariableValue;
  const existing = work.doc.presets.find((p) => p.name === name);
  if (existing) existing.values = values;
  else work.doc.presets.push({ name, values });
  work.touched.presets = true;
}

function applyPreset(work: Work, change: Extract<Change, { type: 'applyPreset' }>): void {
  const preset = work.doc.presets.find((p) => p.name === change.name) ?? fail('name', MESSAGES.unknownPreset);
  for (const [name, value] of Object.entries(preset.values)) {
    const variable = work.doc.variables.find((v) => v.name === name);
    if (variable) variable.value = clone(value as unknown as JsonObject) as unknown as VariableValue;
  }
  work.touched.variables = true;
}

function deletePreset(work: Work, change: Extract<Change, { type: 'deletePreset' }>): void {
  if (!work.doc.presets.some((p) => p.name === change.name)) fail('name', MESSAGES.unknownPreset);
  work.doc.presets = work.doc.presets.filter((p) => p.name !== change.name);
  work.touched.presets = true;
}

function applyOne(work: Work, change: Change): void {
  switch (change.type) {
    case 'addLayer':
      return addLayer(work, change);
    case 'updateLayer':
      return updateLayer(work, change);
    case 'clearOverride':
      return clearOverride(work, change);
    case 'deleteLayer':
      return deleteLayer(work, change);
    case 'moveLayer':
      return moveLayer(work, change);
    case 'duplicateLayer':
      return duplicateLayer(work, change);
    case 'group':
      return group(work, change);
    case 'ungroup':
      return ungroup(work, change);
    case 'setKeyframe':
      return setKeyframe(work, change);
    case 'moveKeyframe':
      return moveKeyframe(work, change);
    case 'deleteKeyframe':
      return deleteKeyframe(work, change);
    case 'updateScene':
      return updateScene(work, change);
    case 'addVariable':
      return addVariable(work, change);
    case 'updateVariable':
      return updateVariable(work, change);
    case 'deleteVariable':
      return deleteVariable(work, change);
    case 'bind':
      return bind(work, change);
    case 'unbind':
      return unbind(work, change);
    case 'savePreset':
      return savePreset(work, change);
    case 'applyPreset':
      return applyPreset(work, change);
    case 'deletePreset':
      return deletePreset(work, change);
  }
}

export const CHANGE_TYPES: readonly Change['type'][] = [
  'addLayer',
  'updateLayer',
  'clearOverride',
  'deleteLayer',
  'moveLayer',
  'duplicateLayer',
  'group',
  'ungroup',
  'setKeyframe',
  'moveKeyframe',
  'deleteKeyframe',
  'updateScene',
  'addVariable',
  'updateVariable',
  'deleteVariable',
  'bind',
  'unbind',
  'savePreset',
  'applyPreset',
  'deletePreset',
];

/**
 * Applies `changes` to a copy of the document. Either every change applies or the first refusal is returned
 * and nothing changes.
 */
export function applyChanges(doc: SceneDocument, sceneId: string, changes: readonly Change[], ctx: DocumentContext): Outcome {
  const next = clone(doc);
  const scene = findScene(next, sceneId);
  if (!scene) return refuse('sceneId', MESSAGES.notFound);
  const work: Work = {
    doc: next,
    scene,
    ctx,
    ids: {},
    touched: { layers: new Map(), removed: new Map(), scenes: new Set(), variables: false, presets: false },
  };
  try {
    for (const change of changes) applyOne(work, change);
  } catch (error) {
    if (error instanceof Invalid) return refuse(error.path, error.message);
    throw error;
  }
  return { ok: true, document: next, ids: work.ids, touched: work.touched };
}

// ---------------------------------------------------------------- patches

export function sceneFieldsOf(scene: Scene): SceneFields {
  const { layers: _layers, ...fields } = scene;
  void _layers;
  return clone(fields);
}

/** The post-change state of everything a change touched. */
export function patchOf(doc: SceneDocument, touched: Touched): Patch {
  const layers: Patch['layers'] = [];
  for (const [layerId, sceneId] of touched.layers) {
    const found = findScene(doc, sceneId)?.layers.find((l) => l.id === layerId);
    if (found) layers.push({ sceneId, layer: clone(found) });
  }
  return {
    scenes: [...touched.scenes].flatMap((id) => {
      const scene = findScene(doc, id);
      return scene ? [sceneFieldsOf(scene)] : [];
    }),
    layers,
    removed: [...touched.removed].map(([layerId, sceneId]) => ({ sceneId, layerId })),
    variables: touched.variables ? clone(doc.variables) : null,
    presets: touched.presets ? clone(doc.presets) : null,
  };
}

/** Merges a patch into a document in place. */
export function applyPatch(doc: SceneDocument, patch: Patch): void {
  for (const fields of patch.scenes) {
    const scene = findScene(doc, fields.id);
    if (scene) Object.assign(scene, clone(fields));
  }
  for (const { sceneId, layerId } of patch.removed) {
    const scene = findScene(doc, sceneId);
    if (scene) scene.layers = scene.layers.filter((l) => l.id !== layerId);
  }
  for (const { sceneId, layer } of patch.layers) {
    const scene = findScene(doc, sceneId);
    if (!scene) continue;
    const at = scene.layers.findIndex((l) => l.id === layer.id);
    if (at >= 0) scene.layers[at] = clone(layer);
    else scene.layers.push(clone(layer));
  }
  if (patch.variables) doc.variables = clone(patch.variables);
  if (patch.presets) doc.presets = clone(patch.presets);
}
