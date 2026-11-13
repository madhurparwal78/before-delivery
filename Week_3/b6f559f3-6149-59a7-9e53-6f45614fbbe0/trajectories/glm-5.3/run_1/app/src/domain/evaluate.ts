// The single evaluator: resolves every layer and scene property for a
// breakpoint, frame, scroll and pointer state, and produces the readouts.
import type { Breakpoint, Easing, Layer, SceneDocument, Variable, Vec3 } from './types';
import { easingValue } from './easing';
import { projectToScreen, lookAt, layerMatrix, DEG, type Mat4 } from './math3d';
import { ARTBOARDS, PRIMITIVES } from './props';
import { formatTimeReadout } from './format';
import { textExtrusion, type ExtrusionGeom } from './extrusion';
import {
  getPath,
  setPath,
  sourceLevel,
  getOverrideValue,
  collectPaths,
} from './paths';

export { getPath, setPath, sourceLevel, collectPaths };

// --- Keyframes ----------------------------------------------------------

export interface KeyframeResult {
  value: number | string | boolean;
  found: boolean;
  easing?: Easing;
}

export function keyframeValue(
  layer: Layer,
  property: string,
  frame: number,
): KeyframeResult {
  const kfs = layer.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.frame - b.frame);
  if (kfs.length === 0) return { value: undefined as never, found: false };
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (frame <= first.frame) return { value: first.value, found: true };
  if (frame >= last.frame) return { value: last.value, found: true };
  for (let i = 0; i < kfs.length - 1; i++) {
    const k1 = kfs[i]!;
    const k2 = kfs[i + 1]!;
    if (frame >= k1.frame && frame <= k2.frame) {
      if (typeof k1.value !== 'number' || typeof k2.value !== 'number') {
        return { value: k1.value, found: true };
      }
      if (k2.frame === k1.frame) return { value: k2.value, found: true };
      const t = (frame - k1.frame) / (k2.frame - k1.frame);
      const E = easingValue(k1.easing, t, frame - k1.frame);
      return { value: k1.value + (k2.value - k1.value) * E, found: true };
    }
  }
  return { value: last.value, found: true };
}

// --- Event progress -----------------------------------------------------

export function appearProgress(
  layer: Layer,
  frame: number,
  loop: { enabled: boolean; loopDelayMs: number } | undefined,
  reduced: boolean,
): number | null {
  const ev = layer.events.appear;
  if (!ev || !ev.enabled) return null;
  const durF = ev.durationMs / (1000 / 60);
  const delayF = ev.delayMs / (1000 / 60);
  let local = frame - delayF;
  if (loop?.enabled) {
    const period = durF + loop.loopDelayMs / (1000 / 60);
    local = period <= 0 ? 0 : ((local % period) + period) % period;
  }
  if (reduced) return 1;
  if (durF <= 0) return 1;
  return easingValue(ev.easing, Math.max(0, Math.min(1, local / durF)));
}

export function hoverProgress(
  layer: Layer,
  hovering: boolean,
  framesHovered: number,
  reduced: boolean,
): number | null {
  const ev = layer.events.hover;
  if (!ev || !ev.enabled) return null;
  if (reduced) return hovering ? 1 : 0;
  const durF = ev.durationMs / (1000 / 60);
  const delayF = ev.delayMs / (1000 / 60);
  const t = Math.max(0, framesHovered - delayF);
  const p = durF <= 0 ? 1 : easingValue(ev.easing, Math.min(1, t / durF));
  return hovering ? p : 1 - p;
}

function scrollProgressOf(layer: Layer, scroll: number, reduced: boolean): number | null {
  const ev = layer.events.scroll;
  if (!ev || !ev.enabled) return null;
  if (reduced) return 1;
  const p = (scroll - ev.delayPct) / ev.durationPct;
  return Math.max(0, Math.min(1, p));
}

// --- Context and results ------------------------------------------------

export interface ModelInfo {
  min: Vec3;
  max: Vec3;
  clips: ClipDataLite[];
  nodes: ModelNodeLite[];
}

export interface ClipDataLite {
  name: string;
  duration: number;
  channels: ClipChannel[];
}

export interface ClipChannel {
  path: 'translation' | 'rotation' | 'scale';
  node: number;
  times: number[];
  values: number[][];
  interpolation: 'LINEAR' | 'STEP';
}

export interface ModelNodeLite {
  name: string;
  translation: Vec3;
  rotation: [number, number, number, number];
  scale: Vec3;
}

export interface SvgInfo {
  points: { x: number; y: number }[];
  width: number;
  height: number;
}

export interface EvalContext {
  frame: number;
  breakpoint: Breakpoint;
  scroll: number;
  reducedMotion: boolean;
  pointer: { x: number; y: number } | null;
  pointerFrames: number;
  hoverLayerIds: Set<string>;
  hoverFrames: number;
  limits: { particleMax: number };
  modelInfo: Map<string, ModelInfo>;
  svgInfo: Map<string, SvgInfo>;
}

export interface ResolvedLayer {
  layer: Layer;
  props: Record<string, unknown>;
  sources: Record<string, Breakpoint>;
  tilt: { x: number; y: number };
  tiltTarget: { x: number; y: number };
  world: Mat4;
  screenPoint: { x: number; y: number } | null;
}

export interface ResolvedScene {
  doc: SceneDocument;
  layers: ResolvedLayer[];
  camera: {
    pos: Vec3;
    target: Vec3;
    fov: number;
    view: Mat4;
    azimuth: number;
  };
  lightFocus: { x: number; y: number };
  time: string;
  frame: number;
}

const LIGHT_REST = { x: 0.8, y: 0.9 };

export function makeEvalContext(partial: Partial<EvalContext>): EvalContext {
  return {
    frame: 0,
    breakpoint: 'desktop',
    scroll: 0,
    reducedMotion: false,
    pointer: null,
    pointerFrames: 0,
    hoverLayerIds: new Set(),
    hoverFrames: 0,
    limits: { particleMax: 2000 },
    modelInfo: new Map(),
    svgInfo: new Map(),
    ...partial,
  };
}

export function evaluateScene(
  doc: SceneDocument,
  ctx: EvalContext,
  vars: Variable[],
): ResolvedScene {
  const bp = ctx.breakpoint;
  const ab = ARTBOARDS[bp];

  // Scene: base values with tablet/mobile overrides on camera-like fields are
  // not published (scene fields are not per-breakpoint except through layers).
  const orbit = doc.orbit;
  const progress = ctx.scroll / 100;
  const azimuth = orbit.enabled
    ? orbit.startAngle + (orbit.endAngle - orbit.startAngle) * progress
    : 0;

  let camPos: Vec3 = { ...doc.camera.position };
  const camTarget: Vec3 = { ...doc.camera.target };
  const a = (ctx.reducedMotion && orbit.enabled ? orbit.endAngle : azimuth) * DEG;
  if (orbit.enabled) {
    const dx = doc.camera.position.x - doc.camera.target.x;
    const dz = doc.camera.position.z - doc.camera.target.z;
    const horiz = Math.hypot(dx, dz);
    camPos = {
      x: camTarget.x + horiz * Math.sin(a),
      y: doc.camera.position.y,
      z: camTarget.z + horiz * Math.cos(a),
    };
  }
  const fov = doc.camera.fov;
  const view = lookAt(camPos, camTarget, { x: 0, y: 1, z: 0 });

  // Light focus: pointer target or rest, smoothed by momentum.
  const f = 1 - 0.92 * doc.light.momentum;
  let lightFocus = { x: LIGHT_REST.x, y: LIGHT_REST.y };
  if (ctx.pointer && doc.light.enabled && !ctx.reducedMotion) {
    const tx = ctx.pointer.x;
    const ty = ctx.pointer.y;
    const steps = ctx.pointerFrames;
    lightFocus = {
      x: 0.8 + (tx - 0.8) * (1 - Math.pow(1 - f, steps)),
      y: 0.9 + (ty - 0.9) * (1 - Math.pow(1 - f, steps)),
    };
  }

  const layers: ResolvedLayer[] = doc.layers.map((layer) =>
    resolveLayer(layer, ctx, vars, view, fov, ab, camPos, camTarget),
  );

  return {
    doc,
    layers,
    camera: { pos: camPos, target: camTarget, fov, view, azimuth },
    lightFocus,
    time: formatTimeReadout(ctx.frame),
    frame: ctx.frame,
  };
}

export function resolveLayer(
  layer: Layer,
  ctx: EvalContext,
  vars: Variable[],
  view: Mat4,
  fov: number,
  ab: { w: number; h: number },
  camPos: Vec3,
  camTarget: Vec3,
): ResolvedLayer {
  void camPos;
  void camTarget;
  const bp = ctx.breakpoint;
  const props: Record<string, unknown> = structuredClone(layer.props);
  const sources: Record<string, Breakpoint> = {};

  // 1. Breakpoint overrides for every leaf path present in the defaults.
  for (const path of collectPaths(props)) {
    sources[path] = sourceLevel(path, bp, layer.overrides);
    if (sources[path] !== 'desktop') {
      const value = getOverrideValue(layer.overrides, sources[path] as 'tablet' | 'mobile', path);
      if (value !== undefined) setPath(props, path, structuredClone(value));
    }
  }

  // 2. Keyframes. Under reduced motion every animation shows its end pose,
  // which for a keyframed property is the last keyframe's value.
  const kfPaths = new Set(layer.keyframes.map((k) => k.property));
  for (const path of kfPaths) {
    if (ctx.reducedMotion) {
      const kfs = layer.keyframes
        .filter((k) => k.property === path)
        .sort((a, b) => a.frame - b.frame);
      const last = kfs[kfs.length - 1];
      if (last) {
        setPath(props, path, structuredClone(last.value));
        if (!(path in sources)) sources[path] = bp;
      }
      continue;
    }
    const { value, found } = keyframeValue(layer, path, ctx.frame);
    if (found) {
      setPath(props, path, structuredClone(value));
      if (!(path in sources)) sources[path] = bp;
    }
  }

  // 3. Events
  const appearP = appearProgress(layer, ctx.frame, layer.events.loop, ctx.reducedMotion);
  if (appearP !== null) {
    for (const [path, fromValue] of Object.entries(layer.events.appear?.from ?? {})) {
      const own = getPath(props, path);
      const ownNum = typeof own === 'number' ? own : 0;
      const fromNum = typeof fromValue === 'number' ? fromValue : 0;
      if (ctx.reducedMotion) {
        setPath(props, path, own);
      } else {
        setPath(props, path, fromNum + (ownNum - fromNum) * appearP);
      }
      if (!(path in sources)) sources[path] = bp;
    }
  }
  const hoverP = hoverProgress(
    layer,
    ctx.hoverLayerIds.has(layer.id),
    ctx.hoverFrames,
    ctx.reducedMotion,
  );
  if (hoverP !== null) {
    for (const [path, toValue] of Object.entries(layer.events.hover?.to ?? {})) {
      const own = getPath(props, path);
      const ownNum = typeof own === 'number' ? own : 0;
      const toNum = typeof toValue === 'number' ? toValue : 0;
      const hovered = ctx.hoverLayerIds.has(layer.id);
      if (ctx.reducedMotion) {
        setPath(props, path, hovered ? toNum : own);
      } else {
        setPath(props, path, ownNum + (toNum - ownNum) * hoverP);
      }
      if (!(path in sources)) sources[path] = bp;
    }
  }
  const scrollP = scrollProgressOf(layer, ctx.scroll, ctx.reducedMotion);
  if (scrollP !== null) {
    for (const [path, fromValue] of Object.entries(layer.events.scroll?.from ?? {})) {
      const own = getPath(props, path);
      const ownNum = typeof own === 'number' ? own : 0;
      const fromNum = typeof fromValue === 'number' ? fromValue : 0;
      if (ctx.reducedMotion) {
        setPath(props, path, own);
      } else {
        setPath(props, path, fromNum + (ownNum - fromNum) * scrollP);
      }
      if (!(path in sources)) sources[path] = bp;
    }
  }

  // 4. Tilt
  const tiltEv = layer.events.tilt;
  let tilt = { x: 0, y: 0 };
  let tiltTarget = { x: 0, y: 0 };
  if (tiltEv?.enabled) {
    if (ctx.reducedMotion) {
      // Tilt stays at rest; the target still reports.
      if (ctx.pointer) {
        const n = ctx.pointer.x * 2 - 1;
        const m = ctx.pointer.y * 2 - 1;
        tiltTarget = {
          y: n * tiltEv.sensitivity * tiltEv.maxTilt,
          x: -m * tiltEv.sensitivity * tiltEv.maxTilt,
        };
      }
    } else if (ctx.pointer) {
      const n = ctx.pointer.x * 2 - 1;
      const m = ctx.pointer.y * 2 - 1;
      tiltTarget = {
        y: n * tiltEv.sensitivity * tiltEv.maxTilt,
        x: -m * tiltEv.sensitivity * tiltEv.maxTilt,
      };
      const f = 1 - 0.92 * tiltEv.momentum;
      const steps = ctx.pointerFrames;
      const ease = 1 - Math.pow(1 - f, steps);
      tilt = { x: tiltTarget.x * ease, y: tiltTarget.y * ease };
      const rot = getPath(props, 'rotation') as Vec3 | undefined;
      if (rot) {
        setPath(props, 'rotation.x', rot.x + tilt.x);
        setPath(props, 'rotation.y', rot.y + tilt.y);
      }
    }
  }

  // 5. Bindings
  for (const [path, varName] of Object.entries(layer.bindings)) {
    const v = vars.find((x) => x.name === varName);
    if (!v) continue;
    applyBinding(props, path, v);
    if (!(path in sources)) sources[path] = bp;
  }

  const world = layerMatrix(
    (getPath(props, 'position') as Vec3) ?? { x: 0, y: 0, z: 0 },
    (getPath(props, 'rotation') as Vec3) ?? { x: 0, y: 0, z: 0 },
    (getPath(props, 'scale') as Vec3) ?? { x: 1, y: 1, z: 1 },
  );

  // Screen point of the layer centre
  const pos = getPath(props, 'position') as Vec3 | undefined;
  let screenPoint: { x: number; y: number } | null = null;
  if (pos) {
    const pr = projectToScreen(pos, view, fov, ab.w, ab.h, NEAR_DEFAULT, FAR_DEFAULT);
    screenPoint = pr.visible ? { x: pr.x, y: pr.y } : null;
  }

  return { layer, props, sources, tilt, tiltTarget, world, screenPoint };
}

const NEAR_DEFAULT = 0.1;
const FAR_DEFAULT = 100;

function applyBinding(props: Record<string, unknown>, path: string, v: Variable): void {
  if (v.type === 'Vector 3') {
    const val = v.value as Vec3;
    if (path.endsWith('.x')) {
      const base = path.slice(0, -2);
      setPath(props, `${base}.x`, val.x);
      setPath(props, `${base}.y`, val.y);
      setPath(props, `${base}.z`, val.z);
    } else {
      setPath(props, path, { ...val });
    }
  } else if (v.type === 'Vector 2') {
    const val = v.value as { x: number; y: number };
    if (path.endsWith('.x')) {
      const base = path.slice(0, -2);
      setPath(props, `${base}.x`, val.x);
      setPath(props, `${base}.y`, val.y);
    } else {
      setPath(props, path, { ...val });
    }
  } else {
    setPath(props, path, v.value as never);
  }
}

// --- Vertices -----------------------------------------------------------

export function localVertex(
  layer: Layer,
  props: Record<string, unknown>,
  name: string,
  ctx: EvalContext,
): Vec3 | null {
  switch (layer.kind) {
    case 'Primitive': {
      const prim = props.primitive as keyof typeof PRIMITIVES;
      const info = PRIMITIVES[prim];
      if (!info) return null;
      if (!info.vertexNames.includes(name)) return null;
      const h = info.halfExtents;
      const sx = name.includes('+x') ? h.x : -h.x;
      const sy = name.includes('+y') ? h.y : -h.y;
      const sz = name.includes('+z') ? h.z : name.includes('-z') ? -h.z : 0;
      return { x: sx, y: sy, z: sz };
    }
    case 'Extrusion': {
      if (props.source === 'svg') {
        const svg = ctx.svgInfo.get(layer.id);
        if (!svg) return null;
        if (name === 'Outline 1') {
          const p = svg.points[0]!;
          return { x: p.x, y: p.y, z: frontZOf(props) };
        }
        if (name.startsWith('Outline ')) {
          const p = svg.points[svg.points.length - 1]!;
          return { x: p.x, y: p.y, z: frontZOf(props) };
        }
        return null;
      }
      const geom = extrusionFor(props);
      if (!geom) return null;
      const idx = CUBE_CORNER_INDEX[name];
      if (idx === undefined) return null;
      const hw = geom.bounds.w / 2;
      const hh = geom.bounds.h / 2;
      const hd = geom.bounds.d / 2;
      return {
        x: name.includes('+x') ? hw : -hw,
        y: name.includes('+y') ? hh : -hh,
        z: name.includes('+z') ? hd : -hd,
      };
    }
    case 'Model': {
      const info = ctx.modelInfo.get(layer.id);
      if (!info) return null;
      const idx = CUBE_CORNER_INDEX[name];
      if (idx === undefined) return null;
      const hw = (info.max.x - info.min.x) / 2;
      const hh = (info.max.y - info.min.y) / 2;
      const hd = (info.max.z - info.min.z) / 2;
      const cx = (info.max.x + info.min.x) / 2;
      const cy = (info.max.y + info.min.y) / 2;
      const cz = (info.max.z + info.min.z) / 2;
      return {
        x: cx + (name.includes('+x') ? hw : -hw),
        y: cy + (name.includes('+y') ? hh : -hh),
        z: cz + (name.includes('+z') ? hd : -hd),
      };
    }
    default:
      return null;
  }
}

const CUBE_CORNER_INDEX: Record<string, number> = {
  '+x +y +z': 0,
  '-x +y +z': 1,
  '+x -y +z': 2,
  '-x -y +z': 3,
  '+x +y -z': 4,
  '-x +y -z': 5,
  '+x -y -z': 6,
  '-x -y -z': 7,
};

export function frontZOf(props: Record<string, unknown>): number {
  const depth = (props.depth as number) ?? 0.2;
  const bevel = (props.bevelSize as number) ?? 0;
  return depth / 2 + bevel;
}

export function extrusionFor(props: Record<string, unknown>): ExtrusionGeom | null {
  if (props.source !== 'text') return null;
  return textExtrusion(
    (props.text as string) ?? '',
    (props.letterHeight as number) ?? 1,
    (props.depth as number) ?? 0.2,
    (props.bevelSize as number) ?? 0,
    (props.bevelSegments as number) ?? 1,
  );
}
