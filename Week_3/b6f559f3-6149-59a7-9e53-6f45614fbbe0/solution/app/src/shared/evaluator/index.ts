import { fixed, framesIn, parseHex, roundTo, timeReadout, vector, hex } from '../format';
import { glyphCorners } from '../geometry';
import { findLayerDefinition, type PropertyDef } from '../properties';
import { ARTBOARDS } from '../types';
import { projectPoint, toLocal, toWorld, vec, type Camera, type Transform } from '../projection';
import { eulerDegrees } from '../quaternion';
import {
  BREAKPOINT_LEVELS,
  type Breakpoint,
  type BreakpointLevel,
  type Json,
  type Layer,
  type Scene,
  type SceneDocument,
  type Variable,
  type Vec3,
} from '../types';
import { clothAt, type ClothParams, type Pinned } from './cloth';
import { clipConfigs, clipTimes, nodePose, type ClipConfig } from './clips';
import { sampleAt, type Rgb, type Surface } from './compositing';
import { emitAt, formAt, type ParticleField } from './particles';
import { bool, num, resolveLayer, resolveScene, str, type EvalContext, type ResolvedLayer, type ResolvedScene } from './resolve';
import {
  drawsBothSides,
  extrusionOf,
  glassIor,
  isGlass,
  modelSummaryOf,
  transformOf,
  triangleCount,
  vertexList,
  type Assets,
} from './solids';

export interface Query {
  layerId?: string;
  frame: number;
  breakpoint: Breakpoint;
  scroll: number;
  reducedMotion: boolean;
  vertex?: string;
  particle?: number;
  point?: string;
  node?: string;
  sampleX?: number;
  sampleY?: number;
}

export interface Settings {
  particleMax: number;
}

interface Evaluation {
  frame: number;
  time: string;
  breakpoint: Breakpoint;
  values: Record<string, number | string>;
  sources: Record<string, BreakpointLevel>;
  readouts: Record<string, string>;
}

export interface ResolvedScenery {
  scene: ResolvedScene;
  layers: ResolvedLayer[];
  context: EvalContext;
  artboard: { width: number; height: number };
}

const SOLID: readonly Layer['kind'][] = ['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth'];
const isSolidLayer = (layer: Layer): boolean => SOLID.includes(layer.kind);

export function contextOf(query: Pick<Query, 'frame' | 'breakpoint' | 'scroll' | 'reducedMotion'>, variables: readonly Variable[]): EvalContext {
  return { breakpoint: query.breakpoint, frame: query.frame, scroll: query.scroll, reducedMotion: query.reducedMotion, variables };
}

export function resolveScenery(scene: Scene, context: EvalContext): ResolvedScenery {
  return {
    scene: resolveScene(scene, context),
    layers: scene.layers.map((layer) => resolveLayer(layer, context)),
    context,
    artboard: ARTBOARDS[context.breakpoint],
  };
}

/** Frame used for simulations: reduced motion shows the state at frame 0. */
export const simulatedFrame = (context: EvalContext): number => (context.reducedMotion ? 0 : context.frame);

export function formatValue(def: PropertyDef | undefined, value: Json | undefined): string {
  if (typeof value === 'number') return fixed(value, 3);
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string') return def?.choices?.find((c) => c.value === value)?.label ?? value;
  return JSON.stringify(value ?? null);
}

/** The inspector's `property` readout text for one field. */
export function propertyReadout(layer: ResolvedLayer, def: PropertyDef, breakpoint: Breakpoint): string {
  const level = layer.sources[def.path] ?? 'Desktop';
  const suffix = level === BREAKPOINT_LEVELS[breakpoint] ? '' : ` (from ${level})`;
  return `${def.label} ${formatValue(def, layer.values[def.path])}${suffix}`;
}

export function valuesOf(layer: ResolvedLayer): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [path, value] of Object.entries(layer.values)) {
    const def = findLayerDefinition(layer.layer, path);
    out[path] = typeof value === 'number' ? roundTo(value, 3) : formatValue(def, value);
  }
  return out;
}

function emitParams(values: Record<string, Json>, settings: Settings): Parameters<typeof emitAt>[0] {
  return {
    seed: num(values, 'seed'),
    burst: Math.floor(num(values, 'burst')),
    rate: num(values, 'rate', 30),
    lifeSteps: Math.floor(num(values, 'lifetime', 2) * 60 + 0.5),
    speed: num(values, 'speed', 2),
    gravity: num(values, 'gravity', 9.8),
    orbit: num(values, 'orbit'),
    attractor: vec(num(values, 'attractor.x'), num(values, 'attractor.y'), num(values, 'attractor.z')),
    strength: num(values, 'attractor.strength'),
    trailLength: Math.floor(num(values, 'trailLength')),
    particleMax: settings.particleMax,
  };
}

/** Where a layer's formation points sit, in the emitter's local space. */
function formationTargets(target: ResolvedLayer, emitter: Transform, assets: Assets): Vec3[] {
  const placed = transformOf(target.values);
  let locals: Vec3[];
  if (target.layer.kind === 'Extrusion') {
    const info = extrusionOf(target.values, assets);
    if (!info) return [];
    const points =
      str(target.values, 'source', 'text') === 'text'
        ? glyphCorners(str(target.values, 'text'), num(target.values, 'letterHeight', 1))
        : info.shape.outlines.flat();
    locals = points.map(([x, y]) => vec(x, y, info.front));
  } else {
    locals = vertexList(target, assets).map((v) => v.point);
  }
  return locals.map((p) => toLocal(toWorld(p, placed), emitter));
}

export function particleField(layer: ResolvedLayer, scenery: ResolvedScenery, assets: Assets, settings: Settings): ParticleField {
  const { values } = layer;
  const frame = simulatedFrame(scenery.context);
  if (str(values, 'mode', 'emit') === 'emit') return emitAt(emitParams(values, settings), frame);
  const targetId = values['formation.target'];
  const target = typeof targetId === 'string' ? scenery.layers.find((l) => l.layer.id === targetId) : undefined;
  const targets = target ? formationTargets(target, transformOf(values), assets) : [];
  return formAt(
    {
      seed: num(values, 'seed'),
      count: Math.min(Math.floor(num(values, 'formation.count', 200)), settings.particleMax),
      durationMs: num(values, 'formation.durationMs', 1500),
      trailLength: 0,
    },
    targets,
    frame,
  );
}

export function clothParams(values: Record<string, Json>): ClothParams {
  return {
    columns: Math.floor(num(values, 'columns', 10)),
    rows: Math.floor(num(values, 'rows', 10)),
    pinned: str(values, 'pinned', 'Top') as Pinned,
    gravity: num(values, 'gravity', 9.8),
    windStrength: num(values, 'windStrength'),
    windDirection: num(values, 'windDirection'),
    stiffness: num(values, 'stiffness', 1),
    damping: num(values, 'damping', 0.02),
    iterations: Math.floor(num(values, 'iterations', 3)),
    seed: num(values, 'seed'),
  };
}

export function clipConfigsOf(layer: ResolvedLayer, assets: Assets): { configs: ClipConfig[]; model: NonNullable<ReturnType<typeof modelSummaryOf>> } | null {
  const model = modelSummaryOf(layer.values, assets);
  return model ? { configs: clipConfigs(layer.values['clips'], model), model } : null;
}

function surfaceOf(scenery: ResolvedScenery, background: string): Surface {
  return { layers: scenery.layers, background: parseHex(background) as Rgb };
}

function sampleText(colour: Rgb): string {
  return `${hex(...colour)} · rgb(${colour.join(', ')})`;
}

function screenText(point: { x: number; y: number } | null): string {
  return point ? `${fixed(point.x, 2)}, ${fixed(point.y, 2)} px` : 'Not visible';
}

function particleText(number: number, position: Vec3): string {
  return `Particle ${number} at ${vector(3, position.x, position.y, position.z)}`;
}

export function drawOrder(layers: readonly ResolvedLayer[]): string[] {
  const ordered: ResolvedLayer[] = [];
  const walk = (parent: string | null): void => {
    for (const l of layers.filter((x) => x.layer.parentId === parent).sort((a, b) => a.layer.order - b.layer.order)) {
      if (l.layer.kind === 'Group') walk(l.layer.id);
      else ordered.push(l);
    }
  };
  walk(null);
  const solids = ordered.filter((l) => isSolidLayer(l.layer) && bool(l.values, 'visible', true));
  const lines = (l: ResolvedLayer, single: string): string[] =>
    drawsBothSides(l.values) ? [`${l.layer.name} · back faces`, `${l.layer.name} · front faces`] : [single];
  return [
    ...solids.filter((l) => bool(l.values, 'depthTest', true)).flatMap((l) => lines(l, `${l.layer.name} · depth on`)),
    ...solids.filter((l) => !bool(l.values, 'depthTest', true)).flatMap((l) => lines(l, `${l.layer.name} · depth off · on top`)),
  ];
}

interface ClipReadout {
  clip: string;
  text: string;
}

export function clipReadouts(layer: ResolvedLayer, scenery: ResolvedScenery, assets: Assets): ClipReadout[] {
  const info = clipConfigsOf(layer, assets);
  if (!info) return [];
  return clipTimes(info.model, info.configs, scenery.context.frame, scenery.context.reducedMotion).map(({ clip, time }) => ({
    clip: clip.name,
    text: `${clip.name} ${fixed(time, 3)} s`,
  }));
}

function solidReadouts(layer: ResolvedLayer, scenery: ResolvedScenery, query: Query, assets: Assets, settings: Settings, out: Record<string, string>): void {
  const { values } = layer;
  const camera: Camera = scenery.scene.camera;
  const transform = transformOf(values);
  out['screen-point'] = screenText(projectPoint(transform.position, camera, scenery.artboard));
  const chosen = query.vertex ? vertexList(layer, assets).find((v) => v.name === query.vertex) : undefined;
  if (chosen) {
    const world = toWorld(chosen.point, transform);
    out['vertex-world'] = vector(3, world.x, world.y, world.z);
    out['vertex-point'] = screenText(projectPoint(world, camera, scenery.artboard));
  }
  const triangles = triangleCount(layer, assets);
  if (triangles !== null) {
    out['triangles'] = `Triangles ${triangles}`;
    out['triangles-drawn'] = `Triangles drawn ${drawsBothSides(values) ? triangles * 2 : triangles}`;
  }
  if (layer.layer.kind === 'Extrusion') {
    const info = extrusionOf(values, assets);
    if (info) out['bounds'] = `Bounds ${fixed(info.box.width, 3)} × ${fixed(info.box.height, 3)} × ${fixed(info.box.depth, 3)}`;
  }
  if (isGlass(values)) out['ior'] = `IOR ${fixed(glassIor(values), 3)}`;
  const frame = simulatedFrame(scenery.context);
  if (layer.layer.kind === 'Particles') {
    const field = particleField(layer, scenery, assets, settings);
    out['live-particles'] = `Live particles ${field.live.length}`;
    if (query.particle !== undefined) {
      const found = field.live.find((p) => p.number === query.particle);
      if (found) {
        out['particle'] = particleText(found.number, found.position);
        const trail = Math.floor(num(values, 'trailLength'));
        out['trail-points'] = `Trail points ${Math.min(trail, frame - found.born + 1)}`;
      } else {
        out['particle'] = `Particle ${query.particle} is not alive at ${timeReadout(scenery.context.frame)}.`;
      }
    }
  }
  if (layer.layer.kind === 'Cloth' && query.point) {
    const point = clothAt(clothParams(values), frame).find((p) => p.name === query.point);
    if (point) out['cloth-point'] = `Cloth point ${point.name} at ${vector(3, point.x, point.y, point.z)}`;
  }
  if (layer.layer.kind === 'Model') {
    const info = clipConfigsOf(layer, assets);
    if (info && query.node && info.model.nodes.some((n) => n.name === query.node)) {
      const pose = nodePose(info.model, info.configs, query.node, scenery.context.frame, scenery.context.reducedMotion);
      out['node-translation'] = `Translation ${vector(3, ...pose.translation)}`;
      out['node-quaternion'] = `Quaternion ${vector(4, ...pose.rotation)}`;
      out['node-euler'] = `Euler ${vector(3, ...eulerDegrees(pose.rotation))}`;
      out['node-scale'] = `Scale ${vector(3, ...pose.scale)}`;
    }
    const first = clipReadouts(layer, scenery, assets)[0];
    if (first) out['clip-time'] = first.text;
  }
}

/** Every readout that applies to the query, keyed as in the brief's readout table. */
export function readoutsOf(scenery: ResolvedScenery, scene: Scene, query: Query, assets: Assets, settings: Settings): Record<string, string> {
  const out: Record<string, string> = { time: timeReadout(query.frame) };
  if (scenery.scene.azimuth !== null) out['camera-azimuth'] = `Camera azimuth ${fixed(scenery.scene.azimuth, 3)}°`;
  if (query.sampleX !== undefined && query.sampleY !== undefined) {
    out['sample'] = sampleText(sampleAt(surfaceOf(scenery, scene.background), query.sampleX, query.sampleY));
  }
  const layer = scenery.layers.find((l) => l.layer.id === query.layerId);
  if (!layer) return out;
  if (isSolidLayer(layer.layer)) solidReadouts(layer, scenery, query, assets, settings, out);
  if (layer.layer.kind === 'Effect') {
    const kind = str(layer.values, 'effect.kind');
    if (kind === 'Blur') {
      const sigma = num(layer.values, 'effect.blurRadius', 8) / 2;
      out['blur'] = `σ ${fixed(sigma, 2)} · ${2 * Math.ceil(3 * sigma) + 1} taps`;
    }
    if (kind === 'Chromatic aberration') {
      const amount = Math.round(num(layer.values, 'effect.aberration', 4));
      out['aberration'] = `R +${amount} px · B -${amount} px`;
    }
  }
  return out;
}

export function evaluate(
  document: Pick<SceneDocument, 'variables'>,
  scene: Scene,
  query: Query,
  assets: Assets,
  settings: Settings,
): Evaluation {
  const scenery = resolveScenery(scene, contextOf(query, document.variables));
  const layer = scenery.layers.find((l) => l.layer.id === query.layerId);
  return {
    frame: query.frame,
    time: timeReadout(query.frame),
    breakpoint: query.breakpoint,
    values: layer ? valuesOf(layer) : {},
    sources: layer ? layer.sources : {},
    readouts: readoutsOf(scenery, scene, query, assets, settings),
  };
}

export function sceneFrames(scene: Scene): number {
  return framesIn(scene.durationMs);
}

;
