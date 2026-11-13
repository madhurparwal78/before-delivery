// Change validation: every write's values checked once, at the boundary.
import type { ApiError } from './errors';
import { validationMessage } from './errors';
import { COPY } from '../domain/copy';
import type { Change } from '../domain/changes';
import type { SceneBundle, SceneDocument, Layer, Variable, Vec3, Easing } from '../domain/kinds';
import { RANGE, type DomainLimits } from '../domain/props';

const EASING_STRINGS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'glide',
  'anticipate',
  'elastic',
  'bouncy',
]);

const EVENT_EASING_PATHS = new Set([
  'events.appear.easing',
  'events.hover.easing',
  'events.scroll.easing',
]);

function isSpring(v: unknown): v is { type: 'spring'; stiffness: number; damping: number; mass: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>).type === 'spring' &&
    typeof (v as Record<string, unknown>).stiffness === 'number' &&
    typeof (v as Record<string, unknown>).damping === 'number' &&
    typeof (v as Record<string, unknown>).mass === 'number'
  );
}

export function validEasing(path: string, v: unknown): boolean {
  if (typeof v === 'string' && EASING_STRINGS.has(v)) return true;
  if (EVENT_EASING_PATHS.has(path)) return false;
  return isSpring(v);
}

const NOT_OVERRIDABLE = new Set([
  'name',
  'kind',
  'order',
  'parentId',
  'maskAbove',
  'blendMode',
  'bindings',
]);

export interface NumberField {
  path: string;
  label: string;
  min: number;
  max: number;
}

// Property ranges by path, derived from the property table.
export function rangeForPath(path: string): NumberField | null {
  const exact: Record<string, [string, number, number]> = {
    x: ['X', -10000, 10000],
    y: ['Y', -10000, 10000],
    width: ['Width', 1, 10000],
    height: ['Height', 1, 10000],
    opacity: ['Opacity', 0, 100],
    sides: ['Sides', 3, 12],
    textSize: ['Text size', 8, 400],
    'material.opacity': ['Material opacity', 0, 1],
    'material.refraction': ['Refraction strength', 0, 2],
    depthTest: ['Depth testing', 0, 1],
    letterHeight: ['Letter height', 0.1, 10],
    depth: ['Extrude depth', 0.01, 10],
    bevelSize: ['Bevel size', 0, 0.5],
    bevelSegments: ['Bevel segments', 1, 4],
    seed: ['Particle seed', 0, 2147483647],
    rate: ['Rate', 0, 600],
    burst: ['Burst', 0, 500],
    lifetime: ['Lifetime', 0.1, 10],
    speed: ['Particle speed', 0, 20],
    gravity: ['Particle gravity', 0, 30],
    trailLength: ['Trail length', 0, 32],
    orbit: ['Orbit', -720, 720],
    'attractor.x': ['Attractor X', -100, 100],
    'attractor.y': ['Attractor Y', -100, 100],
    'attractor.z': ['Attractor Z', -100, 100],
    'attractor.strength': ['Attractor strength', 0, 20],
    'formation.count': ['Count', 1, 2000],
    'formation.durationMs': ['Formation duration', 100, 5000],
    columns: ['Columns', 4, 20],
    rows: ['Rows', 4, 20],
    clothGravity: ['Cloth gravity', 0, 30],
    windStrength: ['Wind strength', 0, 20],
    windDirection: ['Wind direction', 0, 359],
    stiffness: ['Cloth stiffness', 0.1, 1],
    damping: ['Cloth damping', 0, 0.2],
    iterations: ['Constraint iterations', 1, 10],
    clothSeed: ['Cloth seed', 0, 2147483647],
    'gradient.angle': ['Angle', 0, 359],
    'gradient.centerX': ['Centre X', 0, 100],
    'gradient.centerY': ['Centre Y', 0, 100],
    'gradient.radius': ['Radius', 1, 10000],
    'effect.blurRadius': ['Blur radius', 0, 50],
    'effect.grainAmount': ['Grain amount', 0, 1],
    'effect.grainSeed': ['Grain seed', 0, 2147483647],
    'effect.bloomThreshold': ['Bloom threshold', 0, 1],
    'effect.bloomIntensity': ['Bloom intensity', 0, 3],
    'effect.bloomRadius': ['Bloom radius', 0, 50],
    'effect.glowStrength': ['Glow strength', 0, 3],
    'effect.glowThreshold': ['Glow threshold', 0, 1],
    'effect.aberration': ['Aberration amount', 0, 20],
    'effect.displacement': ['Displacement amount', 0, 100],
    'effect.pixelCell': ['Pixel cell', 2, 64],
  };
  const axisMatch = path.match(/^(position|rotation|scale)\.([xyz])$/);
  if (axisMatch) {
    const [, group, axis] = axisMatch;
    const label =
      group === 'position'
        ? 'Position'
        : group === 'rotation'
          ? 'Rotation'
          : 'Scale';
    if (group === 'position') return { path, label: `${label} ${axis!.toUpperCase()}`, min: -100, max: 100 };
    if (group === 'rotation') return { path, label: `${label} ${axis!.toUpperCase()}`, min: -360, max: 360 };
    return { path, label: `${label} ${axis!.toUpperCase()}`, min: 0.01, max: 100 };
  }
  const got = exact[path];
  if (got) return { path, label: got[0], min: got[1], max: got[2] };
  return null;
}

export function isValidChange(ch: unknown): ch is Change {
  return typeof ch === 'object' && ch !== null && typeof (ch as Change).type === 'string';
}

// Validates one change against the current bundle. Returns an ApiError or null.
export function validateChange(
  ch: Change,
  bundle: SceneBundle,
  scene: SceneDocument,
  limits: DomainLimits,
): ApiError | null {
  void limits;
  switch (ch.type) {
    case 'addLayer': {
      const layer = ch.layer as Layer;
      if (!layer || typeof layer !== 'object') {
        return validationMessage('Enter a name.', 'layer');
      }
      if (!layer.name || layer.name.length < 1 || layer.name.length > 60) {
        return validationMessage(COPY.mustBeBetween(1, 60), 'layer.name');
      }
      if (layer.id && scene.layers.some((l) => l.id === layer.id)) {
        return validationMessage('Enter a name.', 'layer.id');
      }
      // Asset readiness
      const assetId = (layer.props?.imageAssetId ?? layer.props?.svgAssetId ?? layer.props?.modelAssetId) as
        | string
        | null
        | undefined;
      if (typeof assetId === 'string' && assetId) {
        // checked by the route with the assets table
      }
      return null;
    }
    case 'updateLayer': {
      const layer = scene.layers.find((l) => l.id === ch.layerId);
      if (!layer) return validationMessage(COPY.notFound, 'layerId');
      if (ch.breakpoint && ch.breakpoint !== 'desktop') {
        if (NOT_OVERRIDABLE.has(ch.set) || NOT_OVERRIDABLE.has(ch.set.split('.')[0]!)) {
          return validationMessage(COPY.notOverridable(fieldLabel(ch.set, layer)), ch.set);
        }
      }
      const value = ch.value;
      const range = rangeForPath(ch.set);
      if (range && typeof value === 'number') {
        if (value < range.min || value > range.max) {
          return validationMessage(COPY.mustBeBetween(range.min, range.max), ch.set);
        }
      }
      if (typeof value === 'string' && looksLikeColour(ch.set)) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
          return validationMessage(COPY.colourFormat, ch.set);
        }
      }
      if (ch.set === 'name' && (typeof value !== 'string' || value.length < 1 || value.length > 60)) {
        return validationMessage(COPY.mustBeBetween(1, 60), 'name');
      }
      if (ch.set === 'text' && typeof value === 'string' && value.length > 200) {
        return validationMessage(COPY.mustBeBetween(0, 200), 'text');
      }
      if (ch.set === 'gradient.stops' && Array.isArray(value)) {
        if (value.length < 2 || value.length > 8) {
          return validationMessage(COPY.gradientStops, 'gradient.stops');
        }
        for (const stop of value as { color?: unknown; position?: unknown }[]) {
          if (typeof stop.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(stop.color)) {
            return validationMessage(COPY.colourFormat, 'gradient.stops');
          }
          if (typeof stop.position !== 'number' || stop.position < 0 || stop.position > 100) {
            return validationMessage(COPY.mustBeBetween(0, 100), 'gradient.stops');
          }
        }
      }
      if ((ch.set === 'events.appear.easing' || ch.set === 'events.hover.easing' || ch.set === 'events.scroll.easing') && !validEasing(ch.set, value)) {
        return validationMessage(COPY.chooseEasing, ch.set);
      }
      if (ch.set.startsWith('keyframes.') || ch.set.includes('easing')) {
        // generic easing path under events handled above
      }
      // Text extrusion characters
      if (ch.set === 'text' && layer.kind === 'Extrusion' && layer.props.source === 'text') {
        for (const c of String(value)) {
          if (!isGlyphChar(c)) {
            return validationMessage(COPY.fontChar(c), 'text');
          }
        }
      }
      return null;
    }
    case 'setKeyframe': {
      const layer = scene.layers.find((l) => l.id === ch.layerId);
      if (!layer) return validationMessage(COPY.notFound, 'layerId');
      if (!Number.isInteger(ch.frame) || ch.frame < 0) {
        return validationMessage(COPY.mustBeBetween(0, 100000), 'frame');
      }
      if (!validEasing(ch.property, ch.easing)) {
        return validationMessage(COPY.chooseEasing, 'easing');
      }
      if (isSpring(ch.easing)) {
        if (ch.easing.stiffness < 1 || ch.easing.stiffness > 1000) {
          return validationMessage(COPY.mustBeBetween(1, 1000), 'easing.stiffness');
        }
        if (ch.easing.damping < 0 || ch.easing.damping > 100) {
          return validationMessage(COPY.mustBeBetween(0, 100), 'easing.damping');
        }
        if (ch.easing.mass < 0.1 || ch.easing.mass > 10) {
          return validationMessage(COPY.mustBeBetween(0.1, 10), 'easing.mass');
        }
      }
      return null;
    }
    case 'addVariable': {
      const v = ch.variable;
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(v.name)) {
        return validationMessage(COPY.variableNamePattern, 'name');
      }
      if (bundle.variables.some((x) => x.name === v.name)) {
        return validationMessage(COPY.variableExists(v.name), 'name');
      }
      return null;
    }
    case 'updateVariable': {
      const v = bundle.variables.find((x) => x.name === ch.name);
      if (!v) return validationMessage(COPY.notFound, 'name');
      return null;
    }
    case 'deleteVariable': {
      if (!bundle.variables.some((x) => x.name === ch.name)) {
        return validationMessage(COPY.notFound, 'name');
      }
      return null;
    }
    case 'bind': {
      const layer = scene.layers.find((l) => l.id === ch.layerId);
      if (!layer) return validationMessage(COPY.notFound, 'layerId');
      const v = bundle.variables.find((x) => x.name === ch.variable);
      if (!v) return validationMessage(COPY.notFound, 'variable');
      if (!bindingCompatible(layer, ch.property, v)) {
        return validationMessage(COPY.chooseEasing, 'property');
      }
      return null;
    }
    case 'savePreset': {
      if (!ch.name || ch.name.length < 1 || ch.name.length > 60) {
        return validationMessage(COPY.mustBeBetween(1, 60), 'name');
      }
      return null;
    }
    case 'applyPreset': {
      if (!bundle.presets.some((p) => p.name === ch.name)) {
        return validationMessage(COPY.notFound, 'name');
      }
      return null;
    }
    case 'deletePreset': {
      if (!bundle.presets.some((p) => p.name === ch.name)) {
        return validationMessage(COPY.notFound, 'name');
      }
      return null;
    }
    case 'group': {
      const members = ch.layerIds
        .map((id) => scene.layers.find((l) => l.id === id))
        .filter((l): l is Layer => !!l);
      if (members.length < 1) return validationMessage(COPY.notFound, 'layerIds');
      const parent = members[0]!.parentId;
      if (!members.every((m) => m.parentId === parent)) {
        return validationMessage('Enter a name.', 'layerIds');
      }
      return null;
    }
    case 'ungroup': {
      const group = scene.layers.find((l) => l.id === ch.groupId);
      if (!group || group.kind !== 'Group') {
        return validationMessage(COPY.notFound, 'groupId');
      }
      return null;
    }
    default:
      return null;
  }
}

function looksLikeColour(path: string): boolean {
  return path === 'fill' || path === 'material.color' || path.endsWith('.color');
}

function isGlyphChar(c: string): boolean {
  return c === ' ' || /[A-Z0-9\-\.!\ ]/.test(c);
}

function fieldLabel(path: string, layer: Layer): string {
  const range = rangeForPath(path);
  if (range) return range.label;
  void layer;
  const labels: Record<string, string> = {
    name: 'Name',
    kind: 'Kind',
    maskAbove: 'Mask the layer above',
    blendMode: 'Blend mode',
  };
  return labels[path] ?? path;
}

function bindingCompatible(layer: Layer, path: string, v: Variable): boolean {
  if (v.type === 'Number') {
    return rangeForPath(path) !== null || path.startsWith('position.') || path.startsWith('rotation.') || path.startsWith('scale.');
  }
  if (v.type === 'Boolean') {
    return path === 'visible' || path === 'effect.enabled';
  }
  if (v.type === 'Text') {
    return path === 'text' && layer.kind === 'Text';
  }
  if (v.type === 'Colour') {
    return looksLikeColour(path);
  }
  if (v.type === 'Vector 2') {
    return (path === 'x' || path === 'y') && ['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient'].includes(layer.kind);
  }
  if (v.type === 'Vector 3') {
    return path === 'position' || path === 'rotation' || path === 'scale';
  }
  return false;
}

export function clampNumberToPath(value: number, path: string): number {
  const r = rangeForPath(path);
  if (!r) return value;
  return Math.max(r.min, Math.min(r.max, value));
}

export function clampLimitLabel(path: string): string {
  const r = rangeForPath(path);
  return r ? `${r.min} and ${r.max}` : '';
}

export type { Vec3, Easing, Variable };
export { RANGE };
