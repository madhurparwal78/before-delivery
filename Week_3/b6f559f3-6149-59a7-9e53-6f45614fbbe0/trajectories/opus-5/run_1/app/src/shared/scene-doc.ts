import { copy, MSG } from './messages';
import {
  TOP_LEVEL_LAYER_PATHS,
  layerPropDefs,
  readPath,
  scenePropDefs,
  writePath,
} from './properties';
import type { PropDef } from './properties';
import { LAYER_KINDS } from './types';
import type {
  JsonObject,
  JsonValue,
  Layer,
  LayerEvents,
  LayerKind,
  Scene,
  SceneDocument,
} from './types';
import { parseEasing } from './easing';

export const SCHEMA_VERSION = 3;

export function defaultEvents(): LayerEvents {
  return {
    appear: { enabled: false, durationMs: 600, delayMs: 0, easing: 'glide', from: {} },
    hover: { enabled: false, durationMs: 300, delayMs: 0, easing: 'glide', forwardsOnly: false, to: {} },
    tilt: { enabled: false, maxTilt: 12, sensitivity: 1, momentum: 1 },
    scroll: { enabled: false, delayPct: 0, durationPct: 50, easing: 'glide', from: {} },
    loop: { enabled: false, loopDelayMs: 0 },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readLayerPath(layer: Layer, path: string): JsonValue | undefined {
  if (TOP_LEVEL_LAYER_PATHS.includes(path) || path.startsWith('events.')) {
    return readPath(layer as unknown as JsonObject, path);
  }
  return readPath(layer.props, path);
}

export function writeLayerPath(layer: Layer, path: string, value: JsonValue): void {
  if (TOP_LEVEL_LAYER_PATHS.includes(path) || path.startsWith('events.')) {
    writePath(layer as unknown as JsonObject, path, value);
    return;
  }
  writePath(layer.props, path, value);
}

export function defaultPropsFor(kind: LayerKind): JsonObject {
  const props: JsonObject = {};
  for (const def of layerPropDefs(kind)) {
    if (TOP_LEVEL_LAYER_PATHS.includes(def.path) || def.path.startsWith('events.')) continue;
    writePath(props, def.path, cloneJson(def.default));
  }
  return props;
}

export function createLayer(input: {
  id: string;
  kind: LayerKind;
  name: string;
  parentId?: string | null;
  order: number;
}): Layer {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    parentId: input.parentId ?? null,
    order: input.order,
    visible: true,
    locked: false,
    maskAbove: false,
    blendMode: 'Normal',
    props: defaultPropsFor(input.kind),
    overrides: { tablet: {}, mobile: {} },
    keyframes: [],
    events: defaultEvents(),
    bindings: {},
  };
}

export function createScene(id: string, name: string): Scene {
  const scene: Scene = {
    id,
    name,
    background: '#0B0B0E',
    environment: 'Flat',
    durationMs: 5000,
    camera: {
      fov: 50,
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      near: 0.1,
      far: 100,
    },
    orbit: { enabled: false, startAngle: 0, endAngle: 90 },
    light: { enabled: true, sensitivity: 1, momentum: 1 },
    layers: [],
  };
  return scene;
}

export function createDocument(name: string, sceneId: string): SceneDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    variables: [],
    presets: [],
    scenes: [createScene(sceneId, 'Main')],
  };
}

/** Fills every default so an export is always complete. */
export function completeDocument(document: SceneDocument): SceneDocument {
  const complete: SceneDocument = {
    schemaVersion: SCHEMA_VERSION,
    name: document.name,
    variables: (document.variables ?? []).map((variable) => ({
      name: variable.name,
      type: variable.type,
      value: cloneJson(variable.value),
    })),
    presets: (document.presets ?? []).map((preset) => ({
      name: preset.name,
      values: cloneJson(preset.values ?? {}),
    })),
    scenes: (document.scenes ?? []).map((scene) => completeScene(scene)),
  };
  return complete;
}

function completeScene(scene: Scene): Scene {
  const base = createScene(scene.id, scene.name);
  const target = base as unknown as JsonObject;
  for (const def of scenePropDefs()) {
    const existing = readPath(scene as unknown as JsonObject, def.path);
    writePath(target, def.path, existing === undefined ? cloneJson(def.default) : cloneJson(existing));
  }
  base.layers = (scene.layers ?? []).map((layer) => completeLayer(layer));
  return base;
}

export function completeLayer(layer: Layer): Layer {
  const base = createLayer({
    id: layer.id,
    kind: layer.kind,
    name: layer.name,
    parentId: layer.parentId ?? null,
    order: layer.order ?? 0,
  });
  for (const def of layerPropDefs(layer.kind)) {
    const existing = readLayerPath(layer, def.path);
    writeLayerPath(base, def.path, existing === undefined ? cloneJson(def.default) : cloneJson(existing));
  }
  base.maskAbove = layer.maskAbove ?? false;
  base.blendMode = layer.blendMode ?? 'Normal';
  base.events.appear.from = cloneJson(layer.events?.appear?.from ?? {});
  base.events.hover.to = cloneJson(layer.events?.hover?.to ?? {});
  base.events.scroll.from = cloneJson(layer.events?.scroll?.from ?? {});
  base.keyframes = (layer.keyframes ?? []).map((keyframe) => ({
    property: keyframe.property,
    frame: keyframe.frame,
    value: cloneJson(keyframe.value),
    easing: cloneJson(keyframe.easing ?? 'linear'),
  }));
  base.bindings = cloneJson(layer.bindings ?? {});
  base.overrides = {
    tablet: cloneJson(layer.overrides?.tablet ?? {}),
    mobile: cloneJson(layer.overrides?.mobile ?? {}),
  };
  return base;
}

export interface ImportProblem {
  message: string;
}

type RawValue = JsonValue | undefined;

function isObject(value: RawValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an import document, reporting the first problem in the published order. */
export function validateImportDocument(parsed: JsonValue): ImportProblem | null {
  if (!isObject(parsed)) return { message: MSG.importMissingSchema };
  if (parsed.schemaVersion === undefined) return { message: MSG.importMissingSchema };
  const version = parsed.schemaVersion;
  if (typeof version !== 'number' || version > SCHEMA_VERSION) {
    return { message: copy.importSchemaVersion(Number(version)) };
  }
  const missing = findMissingField(parsed);
  if (missing) return { message: copy.importMissingField(missing) };
  const unknownKind = findUnknownKind(parsed);
  if (unknownKind) return { message: unknownKind };
  const outOfRange = findOutOfRange(parsed);
  if (outOfRange) return { message: outOfRange };
  return null;
}

function findMissingField(document: JsonObject): string | null {
  if (document.name === undefined) return 'name';
  if (document.scenes === undefined) return 'scenes';
  const scenes = document.scenes;
  if (!Array.isArray(scenes)) return 'scenes';
  for (let s = 0; s < scenes.length; s += 1) {
    const scene = scenes[s];
    if (!isObject(scene)) return `scenes[${s}]`;
    if (scene.id === undefined) return `scenes[${s}].id`;
    if (scene.name === undefined) return `scenes[${s}].name`;
    if (scene.layers === undefined) return `scenes[${s}].layers`;
    const layers = scene.layers;
    if (!Array.isArray(layers)) return `scenes[${s}].layers`;
    for (let l = 0; l < layers.length; l += 1) {
      const layer = layers[l];
      if (!isObject(layer)) return `scenes[${s}].layers[${l}]`;
      if (layer.id === undefined) return `scenes[${s}].layers[${l}].id`;
      if (layer.name === undefined) return `scenes[${s}].layers[${l}].name`;
      if (layer.kind === undefined) return `scenes[${s}].layers[${l}].kind`;
    }
  }
  return null;
}

function findUnknownKind(document: JsonObject): string | null {
  const scenes = Array.isArray(document.scenes) ? document.scenes : [];
  for (let s = 0; s < scenes.length; s += 1) {
    const scene = scenes[s];
    if (!isObject(scene)) continue;
    const layers = Array.isArray(scene.layers) ? scene.layers : [];
    for (let l = 0; l < layers.length; l += 1) {
      const layer = layers[l];
      if (!isObject(layer)) continue;
      const kind = layer.kind;
      if (typeof kind !== 'string' || !(LAYER_KINDS as readonly string[]).includes(kind)) {
        return copy.importUnknownKind(String(kind), `scenes[${s}].layers[${l}].kind`);
      }
    }
  }
  return null;
}

function rangeProblem(def: PropDef, value: JsonValue, path: string): string | null {
  if (def.type !== 'number' || typeof value !== 'number') return null;
  if (def.min === undefined || def.max === undefined) return null;
  if (value < def.min || value > def.max) {
    return copy.importOutOfRange(path, String(value), def.min, def.max);
  }
  return null;
}

function findOutOfRange(document: JsonObject): string | null {
  const scenes = Array.isArray(document.scenes) ? document.scenes : [];
  for (let s = 0; s < scenes.length; s += 1) {
    const scene = scenes[s];
    if (!isObject(scene)) continue;
    for (const def of scenePropDefs()) {
      const value = readPath(scene, def.path);
      if (value === undefined) continue;
      const problem = rangeProblem(def, value, `scenes[${s}].${def.path}`);
      if (problem) return problem;
    }
    const layers = Array.isArray(scene.layers) ? scene.layers : [];
    for (let l = 0; l < layers.length; l += 1) {
      const layer = layers[l];
      if (!isObject(layer)) continue;
      const kind = layer.kind as LayerKind;
      const props = isObject(layer.props) ? layer.props : {};
      for (const def of layerPropDefs(kind)) {
        const container = TOP_LEVEL_LAYER_PATHS.includes(def.path) || def.path.startsWith('events.')
          ? layer
          : props;
        const prefix = container === layer ? '' : 'props.';
        const value = readPath(container, def.path);
        if (value === undefined) continue;
        const problem = rangeProblem(def, value, `scenes[${s}].layers[${l}].${prefix}${def.path}`);
        if (problem) return problem;
      }
      const keyframes = Array.isArray(layer.keyframes) ? layer.keyframes : [];
      for (let k = 0; k < keyframes.length; k += 1) {
        const keyframe = keyframes[k];
        if (!isObject(keyframe)) continue;
        if (keyframe.easing !== undefined && parseEasing(keyframe.easing) === null) {
          return MSG.chooseEasing;
        }
      }
    }
  }
  return null;
}

export function nextLayerName(scene: Scene, kindName: string): string {
  const existing = scene.layers.filter(
    (layer) => layer.name === kindName || layer.name.startsWith(`${kindName} `),
  );
  if (!scene.layers.some((layer) => layer.name === kindName)) return kindName;
  let index = 2;
  while (existing.some((layer) => layer.name === `${kindName} ${index}`)) index += 1;
  return `${kindName} ${index}`;
}
