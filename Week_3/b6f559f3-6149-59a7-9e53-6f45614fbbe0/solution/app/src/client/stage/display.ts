/** What the renderers draw: the evaluator's resolved layers with pointer-driven tilt and hover applied. */
import { isObject } from '../../shared/paths';
import { blendToward } from '../../shared/evaluator/follow';
import {
  clothParams,
  particleField,
  resolveScenery,
  simulatedFrame,
  clipConfigsOf,
  contextOf,
  type ResolvedScenery,
  type Settings,
} from '../../shared/evaluator';
import { stackOf } from '../../shared/evaluator/compositing';
import { clothAt } from '../../shared/evaluator/cloth';
import { nodePose } from '../../shared/evaluator/clips';
import { bool, num, str, type ResolvedLayer } from '../../shared/evaluator/resolve';
import { drawsBothSides, extentOf, extrusionOf, modelSummaryOf, primitiveOf, transformOf, type Assets } from '../../shared/evaluator/solids';
import { extrusionMesh, primitiveMesh, type Mesh } from '../../shared/geometry';
import { presetModel } from '../../shared/presets';
import { composeMatrix, multiplyMatrices, type Quat, type Triple } from '../../shared/quaternion';
import { modelMatrix, projectPoint, type Mat4, type Transform } from '../../shared/projection';
import { MODEL_PRESETS, type Breakpoint, type Json, type ModelPreset, type Scene, type SceneDocument, type Vec3 } from '../../shared/types';
import type { AssetLoader } from './assets';

export interface Dynamics {
  tilt: ReadonlyMap<string, { x: number; y: number }>;
  /** Hover progress 0..1 per layer id. */
  hover: ReadonlyMap<string, number>;
}

export const NO_DYNAMICS: Dynamics = { tilt: new Map(), hover: new Map() };

export interface SceneState {
  document: SceneDocument;
  scene: Scene;
  assets: Assets;
  breakpoint: Breakpoint;
  frame: number;
  scroll: number;
  reducedMotion: boolean;
  dynamics: Dynamics;
  particleMax: number;
  /** Light focus in 0..1 of the artboard; null draws no light field. */
  lightFocus: { x: number; y: number } | null;
}

export interface Solid {
  rl: ResolvedLayer;
  values: Record<string, Json>;
  transform: Transform;
}

export interface Prepared {
  scenery: ResolvedScenery;
  solids: Solid[];
}

export const SOLID_KIND_SET = new Set(['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth']);

function displayValues(rl: ResolvedLayer, dynamics: Dynamics): Record<string, Json> {
  const values: Record<string, Json> = { ...rl.values };
  const tilt = dynamics.tilt.get(rl.layer.id);
  if (tilt) {
    values['rotation.x'] = num(values, 'rotation.x') + tilt.x;
    values['rotation.y'] = num(values, 'rotation.y') + tilt.y;
  }
  const progress = dynamics.hover.get(rl.layer.id);
  const hover = rl.layer.events['hover'];
  if (progress !== undefined && progress > 0 && isObject(hover) && isObject(hover['to'])) {
    const numeric: Record<string, number> = {};
    for (const [path, value] of Object.entries(values)) if (typeof value === 'number') numeric[path] = value;
    const to: Record<string, number> = {};
    for (const [path, value] of Object.entries(hover['to'])) if (typeof value === 'number') to[path] = value;
    Object.assign(values, blendToward(numeric, to, progress));
  }
  return values;
}

export function prepare(state: SceneState): Prepared {
  const context = contextOf({ frame: state.frame, breakpoint: state.breakpoint, scroll: state.scroll, reducedMotion: state.reducedMotion }, state.document.variables);
  const scenery = resolveScenery(state.scene, context);
  const solids: Solid[] = [];
  const walk = (parentId: string | null): void => {
    for (const rl of stackOf(scenery.layers, parentId)) {
      if (!bool(rl.values, 'visible', true)) continue;
      if (rl.layer.kind === 'Group') walk(rl.layer.id);
      else if (SOLID_KIND_SET.has(rl.layer.kind)) {
        const values = displayValues(rl, state.dynamics);
        solids.push({ rl, values, transform: transformOf(values) });
      }
    }
  };
  walk(null);
  return { scenery, solids };
}

// ---------------------------------------------------------------- draw order

export interface DrawItem {
  solid: Solid;
  pass: 'single' | 'back' | 'front';
  depthTest: boolean;
}

/** The brief's draw order: depth-tested layers in stack order, then the rest; both sides draw back faces first. */
export function drawItems(solids: readonly Solid[]): DrawItem[] {
  const items = (solid: Solid): DrawItem[] => {
    const depthTest = bool(solid.values, 'depthTest', true);
    return drawsBothSides(solid.values)
      ? [
          { solid, pass: 'back', depthTest },
          { solid, pass: 'front', depthTest },
        ]
      : [{ solid, pass: 'single', depthTest }];
  };
  return [...solids.filter((s) => bool(s.values, 'depthTest', true)), ...solids.filter((s) => !bool(s.values, 'depthTest', true))].flatMap(items);
}

// ---------------------------------------------------------------- parts

export type Part =
  | { kind: 'mesh'; key: string | null; mesh: Mesh; local: Mat4 }
  | { kind: 'points'; positions: Float32Array }
  | { kind: 'trails'; positions: Float32Array };

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const extrusionCache = new Map<string, Mesh>();

function clothMesh(values: Record<string, Json>, frame: number): Mesh {
  const params = clothParams(values);
  const points = clothAt(params, frame);
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => positions.set([p.x, p.y, p.z], i * 3));
  const indices: number[] = [];
  for (let r = 0; r < params.rows - 1; r++) {
    for (let c = 0; c < params.columns - 1; c++) {
      const a = r * params.columns + c;
      const b = a + 1;
      const d = a + params.columns;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]] as [number, number, number];
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const n: Triple = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const k of [a, b, c]) {
      normals[k * 3]! += n[0];
      normals[k * 3 + 1]! += n[1];
      normals[k * 3 + 2]! += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] = normals[i]! / l;
    normals[i + 1] = normals[i + 1]! / l;
    normals[i + 2] = normals[i + 2]! / l;
  }
  return { positions, normals, indices: new Uint32Array(indices) };
}

function modelParts(solid: Solid, state: SceneState, prepared: Prepared, loader: AssetLoader): Part[] {
  const summary = modelSummaryOf(solid.values, state.assets);
  if (!summary) return [];
  const assetId = solid.values['modelAssetId'];
  const preset = str(solid.values, 'preset');
  const meshes =
    typeof assetId === 'string'
      ? loader.meshes(assetId)
      : (MODEL_PRESETS as readonly string[]).includes(preset)
        ? presetModel(preset as ModelPreset).meshes
        : null;
  if (!meshes) return [];
  const info = clipConfigsOf({ ...solid.rl, values: solid.values }, state.assets);
  const posed = summary.nodes.map((node) => {
    if (!info) return composeMatrix(node.translation, node.rotation, node.scale);
    const pose = nodePose(summary, info.configs, node.name, state.frame, prepared.scenery.context.reducedMotion);
    return composeMatrix(pose.translation, pose.rotation as Quat, pose.scale);
  });
  const world: (Mat4 | undefined)[] = [];
  const resolve = (i: number): Mat4 => {
    const cached = world[i];
    if (cached) return cached;
    const parent = summary.nodes[i]!.parent;
    const matrix = parent === null ? (posed[i] as Mat4) : multiplyMatrices(resolve(parent), posed[i] as Mat4);
    world[i] = matrix;
    return matrix;
  };
  const parts: Part[] = [];
  summary.nodes.forEach((node, i) => {
    const mesh = node.mesh === null ? undefined : meshes[node.mesh];
    if (mesh) parts.push({ kind: 'mesh', key: `${typeof assetId === 'string' ? assetId : preset}:${node.mesh}`, mesh, local: resolve(i) });
  });
  return parts;
}

/** The geometry of a solid layer at the current frame, in the layer's local space. */
export function partsOf(solid: Solid, state: SceneState, prepared: Prepared, loader: AssetLoader): Part[] {
  const { values } = solid;
  switch (solid.rl.layer.kind) {
    case 'Primitive': {
      const primitive = primitiveOf(values);
      return [{ kind: 'mesh', key: `primitive:${primitive}`, mesh: primitiveMesh(primitive), local: IDENTITY }];
    }
    case 'Extrusion': {
      const key = `extrusion:${['source', 'text', 'letterHeight', 'depth', 'bevelSize', 'bevelSegments', 'svgAssetId'].map((k) => String(values[k])).join('|')}`;
      let mesh = extrusionCache.get(key);
      if (!mesh) {
        const info = extrusionOf(values, state.assets);
        if (!info) return [];
        mesh = extrusionMesh(info.shape);
        if (extrusionCache.size > 40) extrusionCache.clear();
        extrusionCache.set(key, mesh);
      }
      return [{ kind: 'mesh', key, mesh, local: IDENTITY }];
    }
    case 'Model':
      return modelParts(solid, state, prepared, loader);
    case 'Cloth':
      return [{ kind: 'mesh', key: null, mesh: clothMesh(values, simulatedFrame(prepared.scenery.context)), local: IDENTITY }];
    case 'Particles': {
      const field = particleField({ ...solid.rl, values }, prepared.scenery, state.assets, { particleMax: state.particleMax } satisfies Settings);
      const points = new Float32Array(field.live.length * 3);
      field.live.forEach((p, i) => points.set([p.position.x, p.position.y, p.position.z], i * 3));
      const parts: Part[] = [{ kind: 'points', positions: points }];
      const trail = Math.floor(num(values, 'trailLength'));
      if (trail > 0) {
        const segments: number[] = [];
        for (const p of field.live) {
          for (let i = 1; i < p.trail.length; i++) {
            const a = p.trail[i - 1] as Vec3;
            const b = p.trail[i] as Vec3;
            segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
        parts.push({ kind: 'trails', positions: new Float32Array(segments) });
      }
      return parts;
    }
    default:
      return [];
  }
}

export const layerMatrix = (solid: Solid): Mat4 => modelMatrix(solid.transform);

// ---------------------------------------------------------------- screen rectangles (hover and selection)

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle spanned by the projected corners of a solid layer's bounding box, in artboard pixels. */
export function screenRect(solid: Solid, prepared: Prepared, assets: Assets): Rect | null {
  const extent = extentOf({ ...solid.rl, values: solid.values }, assets);
  const camera = prepared.scenery.scene.camera;
  const board = prepared.scenery.artboard;
  const corners: Vec3[] = [];
  const e = extent ?? { min: { x: -0.1, y: -0.1, z: 0 }, max: { x: 0.1, y: 0.1, z: 0 } };
  for (const x of [e.min.x, e.max.x]) for (const y of [e.min.y, e.max.y]) for (const z of [e.min.z, e.max.z]) corners.push({ x, y, z });
  const m = modelMatrix(solid.transform);
  const points = corners
    .map((c) => ({
      x: m[0]! * c.x + m[4]! * c.y + m[8]! * c.z + m[12]!,
      y: m[1]! * c.x + m[5]! * c.y + m[9]! * c.z + m[13]!,
      z: m[2]! * c.x + m[6]! * c.y + m[10]! * c.z + m[14]!,
    }))
    .map((p) => projectPoint(p, camera, board))
    .filter((p): p is { x: number; y: number } => p !== null);
  if (points.length === 0) return null;
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}

;
