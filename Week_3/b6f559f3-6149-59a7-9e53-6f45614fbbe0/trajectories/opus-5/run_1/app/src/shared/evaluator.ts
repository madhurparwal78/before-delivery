import { ease, isSpring, springAt } from './easing';
import { fixed, num2, num3, num4, rgbToHex, timeReadout, whole } from './format';
import {
  boxCorners,
  meshTriangleCount,
  orbitedCamera,
  planeCorners,
  primitiveMesh,
  projectPoint,
  PRIMITIVE_HALF_EXTENTS,
  PRIMITIVE_TRIANGLES,
  vec,
  CUBE_CORNER_NAMES,
} from './math3d';
import type { Mesh, Transform } from './math3d';
import {
  displayChoice,
  groupPathOf,
  layerPropDefs,
  is2D,
  is3D,
} from './properties';
import type { PrimitiveKind, PropDef } from './properties';
import { readLayerPath } from './scene-doc';
import type {
  AssetRecord,
  Breakpoint,
  JsonValue,
  Layer,
  Scene,
  SceneDocument,
  Vec3,
  Variable,
} from './types';
import { LEVEL_NAMES } from './types';
import {
  formationPositions,
  simulateEmitter,
  trailPointCount,
} from './particles';

export { formationPositions, simulateEmitter, trailPointCount };
import type { FormationSettings, ParticleSettings } from './particles';
import { simulateCloth } from './cloth';
import type { ClothSettings } from './cloth';
import {
  outlineBounds,
  outlineFormationPoints,
  outlineTriangles,
  textBounds,
  textFormationPoints,
  textMesh,
  outlineMesh,
  textTriangles,
  frontFaceZ,
} from './extrusion';
import type { Outline } from './extrusion';
import {
  clipTime,
  modelBoundingBox,
  nodeTransformAt,
  quaternionToEuler,
} from './gltf';
import type { GltfModel } from './gltf';
import { sampleScene } from './raster';
import type { SampleEffect, SampleLayer, SampleScene } from './raster';
import { presetModel } from './preset-models';

export interface LoadedAsset {
  record: AssetRecord;
  model: GltfModel | null;
  outline: Outline | null;
}

export interface PointerState {
  /** Normalised 0..1 position over the stage. */
  x: number;
  y: number;
  inside: boolean;
}

export interface EvaluateInput {
  document: SceneDocument;
  sceneId: string;
  layerId?: string | null;
  frame: number;
  breakpoint: Breakpoint;
  scroll: number;
  reducedMotion: boolean;
  vertex?: string | null;
  particle?: number | null;
  point?: string | null;
  node?: string | null;
  sampleX?: number | null;
  sampleY?: number | null;
  assets: Record<string, LoadedAsset>;
  particleMax: number;
  tilt?: { x: number; y: number } | null;
  tiltTarget?: { x: number; y: number } | null;
  lightFocus?: { x: number; y: number } | null;
  hoverProgress?: number;
}

export interface EvaluateOutput {
  frame: number;
  time: string;
  breakpoint: Breakpoint;
  values: Record<string, number | string>;
  sources: Record<string, string>;
  readouts: Record<string, string>;
  drawOrder: string[];
  layerValues: { layerName: string; values: Record<string, number | string> }[];
}

export const REST_LIGHT_FOCUS = { x: 0.8, y: 0.9 };

export function smoothingFactor(momentum: number): number {
  return 1 - 0.92 * momentum;
}

export function smoothToward(current: number, target: number, momentum: number): number {
  return current + (target - current) * smoothingFactor(momentum);
}

/** Eases a value back to rest over 1200 ms with Glide. */
export function easeBackToRest(from: number, rest: number, elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / 1200));
  return from + (rest - from) * ease('glide', t);
}

function sceneOf(document: SceneDocument, sceneId: string): Scene | null {
  return document.scenes.find((scene) => scene.id === sceneId) ?? null;
}

function variableValue(document: SceneDocument, name: string): Variable | undefined {
  return document.variables.find((variable) => variable.name === name);
}

function clampToDef(def: PropDef | undefined, value: JsonValue): JsonValue {
  if (!def || def.type !== 'number' || typeof value !== 'number') return value;
  if (def.min !== undefined && value < def.min) return def.min;
  if (def.max !== undefined && value > def.max) return def.max;
  return value;
}

export interface ResolvedValue {
  value: JsonValue;
  source: Breakpoint;
}

const OVERRIDE_CHAIN: Record<Breakpoint, Breakpoint[]> = {
  desktop: ['desktop'],
  tablet: ['tablet', 'desktop'],
  mobile: ['mobile', 'tablet', 'desktop'],
};

/** The breakpoint-resolved stored value for a layer path, before animation. */
export function resolveStored(layer: Layer, path: string, breakpoint: Breakpoint): ResolvedValue {
  for (const level of OVERRIDE_CHAIN[breakpoint]) {
    if (level === 'desktop') {
      const base = readLayerPath(layer, path);
      return { value: base === undefined ? null : base, source: 'desktop' };
    }
    const overrides = layer.overrides[level];
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, path)) {
      return { value: overrides[path], source: level };
    }
  }
  return { value: null, source: 'desktop' };
}

function keyframeValue(layer: Layer, path: string, frame: number, reducedMotion: boolean): JsonValue | undefined {
  const keyframes = layer.keyframes
    .filter((keyframe) => keyframe.property === path)
    .sort((a, b) => a.frame - b.frame);
  if (keyframes.length === 0) return undefined;
  if (reducedMotion) return keyframes[keyframes.length - 1].value;
  if (frame <= keyframes[0].frame) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (frame >= a.frame && frame < b.frame) {
      if (typeof a.value !== 'number' || typeof b.value !== 'number') return a.value;
      const progress = isSpring(a.easing)
        ? springAt(a.easing, frame - a.frame)
        : ease(a.easing, (frame - a.frame) / (b.frame - a.frame));
      return a.value + (b.value - a.value) * progress;
    }
  }
  return last.value;
}

function appearProgress(layer: Layer, frame: number): number {
  const appear = layer.events.appear;
  const timelineMs = (frame * 1000) / 60;
  let elapsed = timelineMs - appear.delayMs;
  if (layer.events.loop.enabled) {
    const cycle = appear.durationMs + layer.events.loop.loopDelayMs;
    if (cycle > 0 && elapsed > 0) elapsed %= cycle;
  }
  if (appear.durationMs <= 0) return elapsed >= 0 ? 1 : 0;
  return ease(appear.easing, Math.max(0, Math.min(1, elapsed / appear.durationMs)));
}

export function scrollEventProgress(layer: Layer, scroll: number): number {
  const event = layer.events.scroll;
  return Math.max(0, Math.min(1, (scroll - event.delayPct) / event.durationPct));
}

export interface LayerResolution {
  values: Map<string, JsonValue>;
  sources: Map<string, Breakpoint>;
  overridden: Set<string>;
  bound: Map<string, string>;
}

/** Resolves every property of a layer at a frame and breakpoint. */
export function resolveLayer(
  document: SceneDocument,
  layer: Layer,
  input: Pick<EvaluateInput, 'frame' | 'breakpoint' | 'scroll' | 'reducedMotion' | 'hoverProgress'>,
): LayerResolution {
  const values = new Map<string, JsonValue>();
  const sources = new Map<string, Breakpoint>();
  const overridden = new Set<string>();
  const bound = new Map<string, string>();
  const defs = layerPropDefs(layer.kind);

  for (const def of defs) {
    const resolved = resolveStored(layer, def.path, input.breakpoint);
    let value = resolved.value;
    sources.set(def.path, resolved.source);
    if (resolved.source !== 'desktop') overridden.add(def.path);
    const groupPath = groupPathOf(def.path);
    const binding = layer.bindings[def.path] ?? (groupPath ? layer.bindings[groupPath] : undefined);
    if (binding) {
      const variable = variableValue(document, binding);
      if (variable) {
        bound.set(def.path, binding);
        value = clampToDef(def, bindingValueFor(def.path, variable));
      }
    }
    values.set(def.path, value);
  }
  values.set('name', layer.name);
  sources.set('name', 'desktop');

  for (const def of defs) {
    const animated = keyframeValue(layer, def.path, input.frame, input.reducedMotion);
    if (animated !== undefined) values.set(def.path, animated);
  }

  const appear = layer.events.appear;
  if (appear.enabled) {
    const progress = input.reducedMotion ? 1 : appearProgress(layer, input.frame);
    for (const [path, from] of Object.entries(appear.from)) {
      const own = values.get(path);
      if (typeof own === 'number' && typeof from === 'number') {
        values.set(path, from + (own - from) * progress);
      } else if (progress < 1) {
        values.set(path, from);
      }
    }
  }

  const scrollEvent = layer.events.scroll;
  if (scrollEvent.enabled) {
    const raw = input.reducedMotion ? 1 : scrollEventProgress(layer, input.scroll);
    const progress = ease(scrollEvent.easing, raw);
    for (const [path, from] of Object.entries(scrollEvent.from)) {
      const own = values.get(path);
      if (typeof own === 'number' && typeof from === 'number') {
        values.set(path, from + (own - from) * progress);
      } else if (progress < 1) {
        values.set(path, from);
      }
    }
  }

  const hover = layer.events.hover;
  if (hover.enabled && !input.reducedMotion && (input.hoverProgress ?? 0) > 0) {
    const progress = ease(hover.easing, Math.max(0, Math.min(1, input.hoverProgress ?? 0)));
    for (const [path, to] of Object.entries(hover.to)) {
      const own = values.get(path);
      if (typeof own === 'number' && typeof to === 'number') {
        values.set(path, own + (to - own) * progress);
      }
    }
  }

  return { values, sources, overridden, bound };
}

function bindingValueFor(path: string, variable: Variable): JsonValue {
  const value = variable.value;
  if (variable.type === 'Vector 3' || variable.type === 'Vector 2') {
    const axis = path.split('.').pop() ?? 'x';
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const component = (value as Record<string, JsonValue>)[axis];
      return component === undefined ? 0 : component;
    }
    return 0;
  }
  return value;
}

export function numberAt(resolution: LayerResolution, path: string, fallback = 0): number {
  const value = resolution.values.get(path);
  return typeof value === 'number' ? value : fallback;
}

export function stringAt(resolution: LayerResolution, path: string, fallback = ''): string {
  const value = resolution.values.get(path);
  return typeof value === 'string' ? value : fallback;
}

export function booleanAt(resolution: LayerResolution, path: string, fallback = false): boolean {
  const value = resolution.values.get(path);
  return typeof value === 'boolean' ? value : fallback;
}

export function layerTransform(resolution: LayerResolution): Transform {
  return {
    position: vec(
      numberAt(resolution, 'position.x'),
      numberAt(resolution, 'position.y'),
      numberAt(resolution, 'position.z'),
    ),
    rotation: vec(
      numberAt(resolution, 'rotation.x'),
      numberAt(resolution, 'rotation.y'),
      numberAt(resolution, 'rotation.z'),
    ),
    scale: vec(
      numberAt(resolution, 'scale.x', 1),
      numberAt(resolution, 'scale.y', 1),
      numberAt(resolution, 'scale.z', 1),
    ),
  };
}

export function formatPropertyValue(def: PropDef, value: JsonValue): string {
  if (def.type === 'number') return num3(typeof value === 'number' ? value : 0);
  if (def.type === 'boolean') return value ? 'On' : 'Off';
  if (def.type === 'choice') return displayChoice(String(value));
  if (def.type === 'colour') return String(value);
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function jsonPropertyValue(def: PropDef, value: JsonValue): number | string {
  if (def.type === 'number') return Number(num3(typeof value === 'number' ? value : 0));
  return formatPropertyValue(def, value);
}

export interface VertexOption {
  name: string;
  point: Vec3;
}

export function layerVertexOptions(
  layer: Layer,
  resolution: LayerResolution,
  assets: Record<string, LoadedAsset>,
): VertexOption[] {
  if (layer.kind === 'Primitive') {
    const primitive = stringAt(resolution, 'primitive', 'Cube') as PrimitiveKind;
    if (primitive === 'Plane') return planeCorners();
    return boxCorners(PRIMITIVE_HALF_EXTENTS[primitive] ?? vec(0.5, 0.5, 0.5));
  }
  if (layer.kind === 'Extrusion') {
    const source = stringAt(resolution, 'source', 'text');
    if (source === 'svg') {
      const outline = outlineFor(resolution, assets);
      if (!outline || outline.points.length === 0) return [];
      const depth = numberAt(resolution, 'depth', 0.2);
      const bevel = numberAt(resolution, 'bevelSize', 0);
      const z = frontFaceZ(depth, bevel);
      const first = outline.points[0];
      const last = outline.points[outline.points.length - 1];
      return [
        { name: 'Outline 1', point: vec(first.x, first.y, z) },
        { name: `Outline ${outline.points.length}`, point: vec(last.x, last.y, z) },
      ];
    }
    const bounds = textBounds(
      stringAt(resolution, 'text', ''),
      numberAt(resolution, 'letterHeight', 1),
      numberAt(resolution, 'depth', 0.2),
      numberAt(resolution, 'bevelSize', 0),
    );
    return boxCorners(vec(bounds.width / 2, bounds.height / 2, bounds.depth / 2));
  }
  if (layer.kind === 'Model') {
    const model = modelFor(resolution, assets);
    if (!model) return [];
    const box = modelBoundingBox(model);
    return CUBE_CORNER_NAMES.map((name) => {
      const parts = name.split(' ');
      return {
        name,
        point: vec(
          parts[0][0] === '+' ? box.max[0] : box.min[0],
          parts[1][0] === '+' ? box.max[1] : box.min[1],
          parts[2][0] === '+' ? box.max[2] : box.min[2],
        ),
      };
    });
  }
  if (layer.kind === 'Cloth') {
    return boxCorners(vec(0.5, 0.5, 0.5));
  }
  return [];
}

export function modelFor(
  resolution: LayerResolution,
  assets: Record<string, LoadedAsset>,
): GltfModel | null {
  const assetId = resolution.values.get('modelAssetId');
  if (typeof assetId === 'string' && assets[assetId]) return assets[assetId].model;
  const preset = resolution.values.get('preset');
  if (typeof preset === 'string' && preset) return presetModel(preset);
  return null;
}

export function outlineFor(
  resolution: LayerResolution,
  assets: Record<string, LoadedAsset>,
): Outline | null {
  const assetId = resolution.values.get('svgAssetId');
  if (typeof assetId === 'string' && assets[assetId]) return assets[assetId].outline;
  return null;
}

export function layerMesh(
  layer: Layer,
  resolution: LayerResolution,
  assets: Record<string, LoadedAsset>,
): Mesh | null {
  if (layer.kind === 'Primitive') {
    return primitiveMesh(stringAt(resolution, 'primitive', 'Cube') as PrimitiveKind);
  }
  if (layer.kind === 'Extrusion') {
    const depth = numberAt(resolution, 'depth', 0.2);
    const bevel = numberAt(resolution, 'bevelSize', 0);
    if (stringAt(resolution, 'source', 'text') === 'svg') {
      const outline = outlineFor(resolution, assets);
      return outline ? outlineMesh(outline, depth, bevel) : null;
    }
    return textMesh(
      stringAt(resolution, 'text', ''),
      numberAt(resolution, 'letterHeight', 1),
      depth,
      bevel,
    );
  }
  if (layer.kind === 'Model') {
    const model = modelFor(resolution, assets);
    if (!model) return null;
    const mesh: Mesh = { positions: [], indices: [] };
    for (const part of model.meshes) {
      const base = mesh.positions.length / 3;
      mesh.positions.push(...part.positions);
      for (const index of part.indices) mesh.indices.push(base + index);
    }
    return mesh;
  }
  return null;
}

export function layerTriangles(
  layer: Layer,
  resolution: LayerResolution,
  assets: Record<string, LoadedAsset>,
): number | null {
  if (layer.kind === 'Primitive') {
    return PRIMITIVE_TRIANGLES[stringAt(resolution, 'primitive', 'Cube') as PrimitiveKind] ?? null;
  }
  if (layer.kind === 'Extrusion') {
    const bevel = numberAt(resolution, 'bevelSize', 0);
    const segments = numberAt(resolution, 'bevelSegments', 1);
    if (stringAt(resolution, 'source', 'text') === 'svg') {
      const outline = outlineFor(resolution, assets);
      return outline ? outlineTriangles(outline.points.length, bevel, segments) : null;
    }
    return textTriangles(stringAt(resolution, 'text', ''), bevel, segments);
  }
  if (layer.kind === 'Model') {
    const mesh = layerMesh(layer, resolution, assets);
    return mesh ? meshTriangleCount(mesh) : null;
  }
  if (layer.kind === 'Cloth') {
    const columns = Math.round(numberAt(resolution, 'columns', 10));
    const rows = Math.round(numberAt(resolution, 'rows', 10));
    return (columns - 1) * (rows - 1) * 2;
  }
  return null;
}

export function particleSettingsOf(resolution: LayerResolution): ParticleSettings {
  return {
    seed: Math.round(numberAt(resolution, 'seed', 7)),
    rate: numberAt(resolution, 'rate', 30),
    burst: numberAt(resolution, 'burst', 0),
    lifetime: numberAt(resolution, 'lifetime', 2),
    speed: numberAt(resolution, 'speed', 2),
    gravity: numberAt(resolution, 'gravity', 9.8),
    trailLength: numberAt(resolution, 'trailLength', 0),
    orbit: numberAt(resolution, 'orbit', 0),
    attractor: {
      x: numberAt(resolution, 'attractor.x', 0),
      y: numberAt(resolution, 'attractor.y', 0),
      z: numberAt(resolution, 'attractor.z', 0),
      strength: numberAt(resolution, 'attractor.strength', 0),
    },
  };
}

export function clothSettingsOf(resolution: LayerResolution): ClothSettings {
  return {
    columns: numberAt(resolution, 'columns', 10),
    rows: numberAt(resolution, 'rows', 10),
    pinned: stringAt(resolution, 'pinned', 'Top'),
    gravity: numberAt(resolution, 'gravity', 9.8),
    windStrength: numberAt(resolution, 'windStrength', 0),
    windDirection: numberAt(resolution, 'windDirection', 0),
    stiffness: numberAt(resolution, 'stiffness', 1),
    damping: numberAt(resolution, 'damping', 0.02),
    iterations: numberAt(resolution, 'iterations', 3),
    seed: Math.round(numberAt(resolution, 'seed', 3)),
  };
}

/** Target points for a formation, in the particle layer's local space. */
export function formationTargets(
  document: SceneDocument,
  scene: Scene,
  resolution: LayerResolution,
  input: Pick<EvaluateInput, 'frame' | 'breakpoint' | 'scroll' | 'reducedMotion'>,
  assets: Record<string, LoadedAsset>,
): Vec3[] {
  const targetId = resolution.values.get('formation.target');
  if (typeof targetId !== 'string') return [];
  const target = scene.layers.find((layer) => layer.id === targetId);
  if (!target) return [];
  const targetResolution = resolveLayer(document, target, input);
  const transform = layerTransform(targetResolution);
  let localPoints: Vec3[] = [];
  if (target.kind === 'Extrusion') {
    const depth = numberAt(targetResolution, 'depth', 0.2);
    const bevel = numberAt(targetResolution, 'bevelSize', 0);
    if (stringAt(targetResolution, 'source', 'text') === 'svg') {
      const outline = outlineFor(targetResolution, assets);
      localPoints = outline ? outlineFormationPoints(outline, depth, bevel) : [];
    } else {
      localPoints = textFormationPoints(
        stringAt(targetResolution, 'text', ''),
        numberAt(targetResolution, 'letterHeight', 1),
        depth,
        bevel,
      );
    }
  } else {
    localPoints = layerVertexOptions(target, targetResolution, assets).map((option) => option.point);
  }
  const particleTransform = layerTransform(resolution);
  return localPoints.map((point) => {
    const world = applyTransformPoint(point, transform);
    return vec(
      world.x - particleTransform.position.x,
      world.y - particleTransform.position.y,
      world.z - particleTransform.position.z,
    );
  });
}

function applyTransformPoint(local: Vec3, transform: Transform): Vec3 {
  let x = local.x * transform.scale.x;
  let y = local.y * transform.scale.y;
  let z = local.z * transform.scale.z;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const cx = Math.cos(toRad(transform.rotation.x));
  const sx = Math.sin(toRad(transform.rotation.x));
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(toRad(transform.rotation.y));
  const sy = Math.sin(toRad(transform.rotation.y));
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cz = Math.cos(toRad(transform.rotation.z));
  const sz = Math.sin(toRad(transform.rotation.z));
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return vec(x + transform.position.x, y + transform.position.y, z + transform.position.z);
}

export function cameraAzimuth(scene: Scene, scroll: number, reducedMotion: boolean): number | null {
  if (!scene.orbit.enabled) return null;
  const progress = reducedMotion ? 1 : scroll / 100;
  return scene.orbit.startAngle + (scene.orbit.endAngle - scene.orbit.startAngle) * progress;
}

function sampleSceneFrom(
  document: SceneDocument,
  scene: Scene,
  input: EvaluateInput,
): SampleScene {
  const layers: SampleLayer[] = [];
  for (const layer of scene.layers) {
    if (!is2D(layer.kind) && layer.kind !== 'Effect' && layer.kind !== 'Group') continue;
    const resolution = resolveLayer(document, layer, input);
    const effect: SampleEffect | null =
      layer.kind === 'Effect'
        ? {
            kind: stringAt(resolution, 'effect.kind', 'Blur') as SampleEffect['kind'],
            enabled: booleanAt(resolution, 'enabled', true),
            blurRadius: numberAt(resolution, 'effect.blurRadius', 8),
            grainAmount: numberAt(resolution, 'effect.grainAmount', 0.15),
            grainSeed: Math.round(numberAt(resolution, 'effect.grainSeed', 11)),
            bloomThreshold: numberAt(resolution, 'effect.bloomThreshold', 0.7),
            bloomIntensity: numberAt(resolution, 'effect.bloomIntensity', 1),
            bloomRadius: numberAt(resolution, 'effect.bloomRadius', 12),
            glowStrength: numberAt(resolution, 'effect.glowStrength', 1),
            glowThreshold: numberAt(resolution, 'effect.glowThreshold', 0.7),
            aberration: numberAt(resolution, 'effect.aberration', 4),
            displacement: numberAt(resolution, 'effect.displacement', 10),
            pixelCell: numberAt(resolution, 'effect.pixelCell', 8),
          }
        : null;
    layers.push({
      id: layer.id,
      parentId: layer.parentId,
      order: layer.order,
      kind: layer.kind,
      visible: booleanAt(resolution, 'visible', true),
      maskAbove: layer.maskAbove,
      blendMode: layer.blendMode,
      x: numberAt(resolution, 'x', 0),
      y: numberAt(resolution, 'y', 0),
      width: numberAt(resolution, 'width', 200),
      height: numberAt(resolution, 'height', 200),
      opacity: numberAt(resolution, 'opacity', 100),
      fill: stringAt(resolution, 'fill', '#FFFFFF'),
      sides: numberAt(resolution, 'sides', 6),
      gradient:
        layer.kind === 'Gradient'
          ? {
              type: stringAt(resolution, 'gradient.type', 'Linear'),
              angle: numberAt(resolution, 'gradient.angle', 0),
              centerX: numberAt(resolution, 'gradient.centerX', 50),
              centerY: numberAt(resolution, 'gradient.centerY', 50),
              radius: numberAt(resolution, 'gradient.radius', 100),
              stops: stopsOf(resolution),
            }
          : null,
      effect,
    });
  }
  return { background: scene.background, layers };
}

function stopsOf(resolution: LayerResolution): { color: string; position: number }[] {
  const stops = resolution.values.get('gradient.stops');
  if (!Array.isArray(stops)) return [];
  return stops.map((stop) => {
    const record = stop as Record<string, JsonValue>;
    return {
      color: typeof record.color === 'string' ? record.color : '#000000',
      position: typeof record.position === 'number' ? record.position : 0,
    };
  });
}

export function drawOrderItems(
  document: SceneDocument,
  scene: Scene,
  input: EvaluateInput,
): string[] {
  const entries = scene.layers
    .filter((layer) => is3D(layer.kind))
    .sort((a, b) => a.order - b.order)
    .map((layer) => {
      const resolution = resolveLayer(document, layer, input);
      const bothSides =
        stringAt(resolution, 'faces', 'front') === 'both' ||
        (stringAt(resolution, 'material.kind', 'Matcap') === 'Glass' &&
          booleanAt(resolution, 'material.backFaceRefraction', false));
      return {
        name: layer.name,
        visible: booleanAt(resolution, 'visible', true),
        depthTest: booleanAt(resolution, 'depthTest', true),
        bothSides,
      };
    })
    .filter((entry) => entry.visible);
  const items: string[] = [];
  for (const entry of entries.filter((item) => item.depthTest)) {
    if (entry.bothSides) {
      items.push(`${entry.name} · back faces`, `${entry.name} · front faces`);
    } else {
      items.push(`${entry.name} · depth on`);
    }
  }
  for (const entry of entries.filter((item) => !item.depthTest)) {
    if (entry.bothSides) {
      items.push(`${entry.name} · back faces`, `${entry.name} · front faces`);
    } else {
      items.push(`${entry.name} · depth off · on top`);
    }
  }
  return items;
}

function screenPointText(point: { x: number; y: number; visible: boolean }): string {
  return point.visible ? `${num2(point.x)}, ${num2(point.y)} px` : 'Not visible';
}

export function evaluate(input: EvaluateInput): EvaluateOutput {
  const scene = sceneOf(input.document, input.sceneId);
  const values: Record<string, number | string> = {};
  const sources: Record<string, string> = {};
  const readouts: Record<string, string> = {};
  const layerValues: { layerName: string; values: Record<string, number | string> }[] = [];
  readouts.time = timeReadout(input.frame);
  if (!scene) {
    return {
      frame: input.frame,
      time: readouts.time,
      breakpoint: input.breakpoint,
      values,
      sources,
      readouts,
      drawOrder: [],
      layerValues,
    };
  }

  const azimuth = cameraAzimuth(scene, input.scroll, input.reducedMotion);
  const camera = orbitedCamera(scene.camera, azimuth);
  if (azimuth !== null) readouts['camera-azimuth'] = `Camera azimuth ${num3(azimuth)}°`;

  for (const layer of scene.layers) {
    const resolution = resolveLayer(input.document, layer, input);
    const perLayer: Record<string, number | string> = {};
    for (const def of layerPropDefs(layer.kind)) {
      const value = resolution.values.get(def.path);
      if (value === undefined) continue;
      perLayer[def.path] = jsonPropertyValue(def, value);
    }
    layerValues.push({ layerName: layer.name, values: perLayer });
  }

  const layer = input.layerId
    ? scene.layers.find((candidate) => candidate.id === input.layerId) ?? null
    : null;

  if (layer) {
    const resolution = resolveLayer(input.document, layer, input);
    for (const def of layerPropDefs(layer.kind)) {
      const value = resolution.values.get(def.path);
      if (value === undefined) continue;
      values[def.path] = jsonPropertyValue(def, value);
      const source = resolution.sources.get(def.path) ?? 'desktop';
      sources[def.path] = LEVEL_NAMES[source];
      const fromLevel =
        source !== input.breakpoint ? ` (from ${LEVEL_NAMES[source]})` : '';
      readouts[`property:${def.path}`] = `${def.field} ${formatPropertyValue(def, value)}${fromLevel}`;
    }
    values.name = layer.name;
    readouts['property:name'] = `Name ${layer.name}`;

    if (is3D(layer.kind)) {
      const transform = layerTransform(resolution);
      readouts['screen-point'] = screenPointText(
        projectPoint(transform.position, camera, input.breakpoint),
      );
      const vertexOptions = layerVertexOptions(layer, resolution, input.assets);
      if (vertexOptions.length > 0) {
        const chosen =
          vertexOptions.find((option) => option.name === input.vertex) ?? vertexOptions[0];
        const world = applyTransformPoint(chosen.point, transform);
        readouts['vertex-point'] = screenPointText(projectPoint(world, camera, input.breakpoint));
        readouts['vertex-world'] = `${num3(world.x)}, ${num3(world.y)}, ${num3(world.z)}`;
      }
      const triangles = layerTriangles(layer, resolution, input.assets);
      if (triangles !== null) {
        readouts.triangles = `Triangles ${whole(triangles)}`;
        const bothSides =
          stringAt(resolution, 'faces', 'front') === 'both' ||
          (stringAt(resolution, 'material.kind', 'Matcap') === 'Glass' &&
            booleanAt(resolution, 'material.backFaceRefraction', false));
        readouts['triangles-drawn'] = `Triangles drawn ${whole(bothSides ? triangles * 2 : triangles)}`;
      }
      if (stringAt(resolution, 'material.kind', 'Matcap') === 'Glass') {
        readouts.ior = `IOR ${num3(1 + 0.25 * numberAt(resolution, 'material.refraction', 1))}`;
      }
    } else if (is2D(layer.kind)) {
      const x = numberAt(resolution, 'x', 0) + numberAt(resolution, 'width', 0) / 2;
      const y = numberAt(resolution, 'y', 0) + numberAt(resolution, 'height', 0) / 2;
      readouts['screen-point'] = `${num2(x)}, ${num2(y)} px`;
    }

    if (layer.kind === 'Extrusion') {
      const depth = numberAt(resolution, 'depth', 0.2);
      const bevel = numberAt(resolution, 'bevelSize', 0);
      const bounds =
        stringAt(resolution, 'source', 'text') === 'svg'
          ? (() => {
              const outline = outlineFor(resolution, input.assets);
              return outline ? outlineBounds(outline, depth, bevel) : null;
            })()
          : textBounds(
              stringAt(resolution, 'text', ''),
              numberAt(resolution, 'letterHeight', 1),
              depth,
              bevel,
            );
      if (bounds) {
        readouts.bounds = `Bounds ${num3(bounds.width)} × ${num3(bounds.height)} × ${num3(bounds.depth)}`;
      }
    }

    if (layer.kind === 'Effect') {
      const kind = stringAt(resolution, 'effect.kind', 'Blur');
      if (kind === 'Blur') {
        const radius = numberAt(resolution, 'effect.blurRadius', 8);
        const sigma = radius / 2;
        readouts.blur = `σ ${fixed(sigma, 2)} · ${2 * Math.ceil(3 * sigma) + 1} taps`;
      }
      if (kind === 'Chromatic aberration') {
        const amount = Math.round(numberAt(resolution, 'effect.aberration', 4));
        readouts.aberration = `R +${amount} px · B -${amount} px`;
      }
    }

    if (layer.kind === 'Particles') {
      const mode = stringAt(resolution, 'mode', 'emit');
      const frame = input.reducedMotion ? 0 : input.frame;
      const particleNumber = input.particle ?? 1;
      if (mode === 'form') {
        const settings: FormationSettings = {
          seed: Math.round(numberAt(resolution, 'seed', 7)),
          count: Math.round(numberAt(resolution, 'formation.count', 200)),
          durationMs: numberAt(resolution, 'formation.durationMs', 1500),
          targets: formationTargets(input.document, scene, resolution, input, input.assets),
        };
        const positions = formationPositions(settings, frame);
        readouts['live-particles'] = `Live particles ${whole(positions.length)}`;
        const position = positions[particleNumber - 1];
        readouts.particle = position
          ? `Particle ${particleNumber} at ${num3(position.x)}, ${num3(position.y)}, ${num3(position.z)}`
          : `Particle ${particleNumber} is not alive at ${timeReadout(input.frame)}.`;
      } else {
        const settings = particleSettingsOf(resolution);
        const live = simulateEmitter(settings, frame, input.particleMax);
        readouts['live-particles'] = `Live particles ${whole(live.length)}`;
        const particle = live.find((candidate) => candidate.number === particleNumber);
        readouts.particle = particle
          ? `Particle ${particleNumber} at ${num3(particle.position.x)}, ${num3(particle.position.y)}, ${num3(particle.position.z)}`
          : `Particle ${particleNumber} is not alive at ${timeReadout(input.frame)}.`;
        if (particle) {
          readouts['trail-points'] = `Trail points ${whole(
            trailPointCount(settings.trailLength, frame - particle.bornStep),
          )}`;
        }
      }
    }

    if (layer.kind === 'Cloth') {
      const settings = clothSettingsOf(resolution);
      const points = simulateCloth(settings, input.reducedMotion ? 0 : input.frame);
      const chosen = points.find((candidate) => candidate.name === input.point) ?? points[0];
      if (chosen) {
        readouts['cloth-point'] = `Cloth point ${chosen.name} at ${num3(chosen.position.x)}, ${num3(
          chosen.position.y,
        )}, ${num3(chosen.position.z)}`;
      }
    }

    if (layer.kind === 'Model') {
      const model = modelFor(resolution, input.assets);
      if (model) {
        const playbacks = clipPlaybacks(resolution, model);
        const timelineSeconds = input.reducedMotion ? 0 : input.frame / 60;
        for (const entry of playbacks) {
          readouts[`clip-time:${entry.clip.name}`] = `${entry.clip.name} ${num3(
            clipTime(entry.playback, entry.clip.durationS, timelineSeconds),
          )} s`;
        }
        const nodeIndex = model.nodes.findIndex((candidate) => candidate.name === input.node);
        const index = nodeIndex >= 0 ? nodeIndex : 0;
        if (model.nodes[index]) {
          const transform = nodeTransformAt(model, index, playbacks, timelineSeconds);
          readouts['node-translation'] = `Translation ${num3(transform.translation[0])}, ${num3(
            transform.translation[1],
          )}, ${num3(transform.translation[2])}`;
          readouts['node-quaternion'] = `Quaternion ${num4(transform.rotation[0])}, ${num4(
            transform.rotation[1],
          )}, ${num4(transform.rotation[2])}, ${num4(transform.rotation[3])}`;
          const euler = quaternionToEuler(transform.rotation);
          readouts['node-euler'] = `Euler ${num3(euler[0])}, ${num3(euler[1])}, ${num3(euler[2])}`;
          readouts['node-scale'] = `Scale ${num3(transform.scale[0])}, ${num3(
            transform.scale[1],
          )}, ${num3(transform.scale[2])}`;
        }
      }
    }

    const tiltEvent = layer.events.tilt;
    if (tiltEvent.enabled) {
      const target = input.reducedMotion ? { x: 0, y: 0 } : input.tiltTarget ?? { x: 0, y: 0 };
      const current = input.reducedMotion ? { x: 0, y: 0 } : input.tilt ?? { x: 0, y: 0 };
      readouts['tilt-x'] = `Tilt X ${num3(current.x)}`;
      readouts['tilt-y'] = `Tilt Y ${num3(current.y)}`;
      readouts['tilt-target'] = `Tilt target ${num3(target.x)}, ${num3(target.y)}`;
    }
  }

  if (scene.light.enabled) {
    const focus = input.reducedMotion ? REST_LIGHT_FOCUS : input.lightFocus ?? REST_LIGHT_FOCUS;
    readouts['light-focus'] = `Light focus ${num3(focus.x)}, ${num3(focus.y)}`;
  }

  if (input.sampleX !== null && input.sampleX !== undefined && input.sampleY !== null && input.sampleY !== undefined) {
    const rgb = sampleScene(sampleSceneFrom(input.document, scene, input), {
      x: input.sampleX,
      y: input.sampleY,
    });
    readouts.sample = `${rgbToHex(rgb)} · rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  return {
    frame: input.frame,
    time: readouts.time,
    breakpoint: input.breakpoint,
    values,
    sources,
    readouts,
    drawOrder: drawOrderItems(input.document, scene, input),
    layerValues,
  };
}

export interface ClipEntry {
  clip: GltfModel['clips'][number];
  playback: { name: string; play: boolean; loop: boolean; speed: number; offsetMs: number };
}

export function clipPlaybacks(resolution: LayerResolution, model: GltfModel): ClipEntry[] {
  const stored = resolution.values.get('clips');
  const list = Array.isArray(stored) ? stored : [];
  return model.clips.map((clip) => {
    const record = list.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Record<string, JsonValue>).name === clip.name,
    ) as Record<string, JsonValue> | undefined;
    return {
      clip,
      playback: {
        name: clip.name,
        play: record?.play === true,
        loop: record?.loop === true,
        speed: typeof record?.speed === 'number' ? record.speed : 1,
        offsetMs: typeof record?.offsetMs === 'number' ? record.offsetMs : 0,
      },
    };
  });
}
