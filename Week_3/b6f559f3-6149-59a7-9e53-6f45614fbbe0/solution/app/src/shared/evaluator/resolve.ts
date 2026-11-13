import { boundValue, bindingPaths } from '../bindings';
import { ease } from '../easing';
import { FRAMES_PER_SECOND } from '../format';
import { flatten, getPath, isObject } from '../paths';
import { EVENT_PROPERTIES, findLayerDefinition, SCENE_PROPERTIES } from '../properties';
import { orbitCamera, vec, type Camera } from '../projection';
import {
  BREAKPOINT_LEVELS,
  type Breakpoint,
  type BreakpointLevel,
  type Easing,
  type EasingName,
  EASING_NAMES,
  type Json,
  type Keyframe,
  type Layer,
  type OverrideMap,
  type Scene,
  type Variable,
} from '../types';

export interface EvalContext {
  breakpoint: Breakpoint;
  frame: number;
  /** Scroll progress, 0 to 100. */
  scroll: number;
  reducedMotion: boolean;
  variables: readonly Variable[];
}

export interface BoundInfo {
  variable: string;
  /** The range end the value was clamped to, or null when it fit. */
  limit: number | null;
}

export interface ResolvedLayer {
  layer: Layer;
  values: Record<string, Json>;
  sources: Record<string, BreakpointLevel>;
  bound: Record<string, BoundInfo>;
}

export interface ResolvedScene {
  camera: Camera;
  /** The orbit azimuth in degrees, or null while the scroll orbit is off. */
  azimuth: number | null;
  values: Record<string, Json>;
  sources: Record<string, BreakpointLevel>;
}

/** Breakpoint levels consulted for a breakpoint, nearest first: Mobile, then Tablet, then Desktop. */
function chain(breakpoint: Breakpoint): ('mobile' | 'tablet')[] {
  if (breakpoint === 'mobile') return ['mobile', 'tablet'];
  return breakpoint === 'tablet' ? ['tablet'] : [];
}

function applyOverrides(
  values: Record<string, Json>,
  sources: Record<string, BreakpointLevel>,
  overrides: { tablet: OverrideMap; mobile: OverrideMap },
  breakpoint: Breakpoint,
): void {
  for (const level of chain(breakpoint).reverse()) {
    for (const [path, value] of Object.entries(overrides[level])) {
      values[path] = value;
      sources[path] = BREAKPOINT_LEVELS[level];
    }
  }
}

export const num = (values: Record<string, Json>, path: string, fallback = 0): number => {
  const value = values[path];
  return typeof value === 'number' ? value : fallback;
};
export const str = (values: Record<string, Json>, path: string, fallback = ''): string => {
  const value = values[path];
  return typeof value === 'string' ? value : fallback;
};
export const bool = (values: Record<string, Json>, path: string, fallback = false): boolean => {
  const value = values[path];
  return typeof value === 'boolean' ? value : fallback;
};

const EASING_SET: readonly string[] = EASING_NAMES;

export function easingOf(value: Json | undefined, fallback: EasingName): Easing {
  if (typeof value === 'string' && EASING_SET.includes(value)) return value as EasingName;
  if (isObject(value) && value['type'] === 'spring') {
    return {
      type: 'spring',
      stiffness: typeof value['stiffness'] === 'number' ? value['stiffness'] : 170,
      damping: typeof value['damping'] === 'number' ? value['damping'] : 26,
      mass: typeof value['mass'] === 'number' ? value['mass'] : 1,
    };
  }
  return fallback;
}

/** The value of one property's keyframes at `frame`. */
function keyframeValue(keyframes: readonly Keyframe[], frame: number): number {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  const first = sorted[0] as Keyframe;
  const last = sorted[sorted.length - 1] as Keyframe;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  const index = sorted.findIndex((k) => k.frame > frame) - 1;
  const from = sorted[index] as Keyframe;
  const to = sorted[index + 1] as Keyframe;
  const span = to.frame - from.frame;
  const progress = ease(from.easing, (frame - from.frame) / span, frame - from.frame);
  return from.value + (to.value - from.value) * progress;
}

function endPose(keyframes: readonly Keyframe[]): number {
  return [...keyframes].sort((a, b) => a.frame - b.frame).pop()?.value ?? 0;
}

/** The `from` or `to` values of an event, which are stored whole and never overridden. */
function eventTargets(layer: Layer, event: string, key: 'from' | 'to'): Json | undefined {
  const stored = layer.events[event];
  return isObject(stored) ? stored[key] : undefined;
}

function applyFrom(values: Record<string, Json>, from: Json | undefined, progress: number): void {
  if (!isObject(from)) return;
  for (const [path, start] of Object.entries(from)) {
    const own = values[path];
    if (typeof start === 'number' && typeof own === 'number') values[path] = start + (own - start) * progress;
  }
}

/** Resolves every property value of a layer for the breakpoint, frame and scroll of `context`. */
export function resolveLayer(layer: Layer, context: EvalContext): ResolvedLayer {
  const values: Record<string, Json> = { ...flatten(layer.props), visible: layer.visible };
  for (const def of EVENT_PROPERTIES) {
    const own = def.control === 'custom' ? undefined : getPath(layer.events, def.path.slice('events.'.length));
    if (own !== undefined) values[def.path] = own;
  }
  const sources: Record<string, BreakpointLevel> = {};
  for (const path of Object.keys(values)) sources[path] = 'Desktop';
  applyOverrides(values, sources, layer.overrides, context.breakpoint);

  const bound: Record<string, BoundInfo> = {};
  for (const [property, name] of Object.entries(layer.bindings)) {
    const variable = context.variables.find((v) => v.name === name);
    if (!variable) continue;
    const paths = bindingPaths(layer, property, variable.type);
    if (typeof paths === 'string') continue;
    for (const path of paths) {
      const result = boundValue(findLayerDefinition(layer, path), variable.type, variable.value, path);
      values[path] = result.value;
      bound[path] = { variable: name, limit: result.limit };
    }
  }

  const byProperty = new Map<string, Keyframe[]>();
  for (const keyframe of layer.keyframes) {
    if (bound[keyframe.property]) continue;
    byProperty.set(keyframe.property, [...(byProperty.get(keyframe.property) ?? []), keyframe]);
  }
  for (const [property, keyframes] of byProperty) {
    values[property] = context.reducedMotion ? endPose(keyframes) : keyframeValue(keyframes, context.frame);
  }

  if (!context.reducedMotion) {
    if (bool(values, 'events.appear.enabled')) {
      const duration = num(values, 'events.appear.durationMs', 600);
      const delay = num(values, 'events.appear.delayMs', 0);
      let time = (context.frame * 1000) / FRAMES_PER_SECOND;
      const cycle = duration + num(values, 'events.loop.loopDelayMs');
      if (bool(values, 'events.loop.enabled') && cycle > 0) time %= cycle;
      const t = duration === 0 ? (time >= delay ? 1 : 0) : (time - delay) / duration;
      const easing = easingOf(values['events.appear.easing'], 'glide');
      applyFrom(values, eventTargets(layer, 'appear', 'from'), ease(easing, Math.min(Math.max(t, 0), 1), 0));
    }
    if (bool(values, 'events.scroll.enabled')) {
      const span = Math.max(num(values, 'events.scroll.durationPct', 50), 1e-9);
      const t = Math.min(Math.max((context.scroll - num(values, 'events.scroll.delayPct', 0)) / span, 0), 1);
      const easing = easingOf(values['events.scroll.easing'], 'glide');
      applyFrom(values, eventTargets(layer, 'scroll', 'from'), ease(easing, t, 0));
    }
  }

  for (const [path, value] of Object.entries(values)) {
    const def = findLayerDefinition(layer, path);
    if (typeof value === 'number' && def?.integer) values[path] = Math.round(value);
  }
  return { layer, values, sources, bound };
}

export function resolveScene(scene: Scene, context: EvalContext): ResolvedScene {
  const values: Record<string, Json> = {};
  const sources: Record<string, BreakpointLevel> = {};
  for (const def of SCENE_PROPERTIES) {
    const raw = def.path.split('.').reduce<Json | undefined>((node, part) => (isObject(node) ? node[part] : undefined), scene as unknown as Json);
    if (raw !== undefined) {
      values[def.path] = raw;
      sources[def.path] = 'Desktop';
    }
  }
  applyOverrides(values, sources, scene.overrides, context.breakpoint);
  const camera: Camera = {
    fov: num(values, 'camera.fov', 50),
    near: num(values, 'camera.near', 0.1),
    far: num(values, 'camera.far', 100),
    position: vec(num(values, 'camera.position.x'), num(values, 'camera.position.y'), num(values, 'camera.position.z', 10)),
    target: vec(num(values, 'camera.target.x'), num(values, 'camera.target.y'), num(values, 'camera.target.z')),
  };
  if (!bool(values, 'orbit.enabled')) return { camera, azimuth: null, values, sources };
  const start = num(values, 'orbit.startAngle');
  const end = num(values, 'orbit.endAngle', 90);
  const azimuth = context.reducedMotion ? end : start + (end - start) * (context.scroll / 100);
  return { camera: orbitCamera(camera, azimuth), azimuth, values, sources };
}

