import type { JsonObject, JsonValue, LayerKind } from './types';

export type PropType = 'number' | 'colour' | 'boolean' | 'text' | 'choice' | 'asset' | 'list';

export interface PropDef {
  path: string;
  field: string;
  type: PropType;
  min?: number;
  max?: number;
  step?: number;
  shiftStep?: number;
  minLength?: number;
  maxLength?: number;
  choices?: readonly string[];
  overridable: boolean;
  default: JsonValue;
}

export const EFFECT_KINDS = [
  'Blur',
  'Grain',
  'Bloom',
  'Glow',
  'Chromatic aberration',
  'Displacement',
  'Pixelate',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const PRIMITIVES = ['Cube', 'Sphere', 'Cylinder', 'Torus', 'Plane'] as const;
export type PrimitiveKind = (typeof PRIMITIVES)[number];

export const BLEND_MODES = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten'] as const;
export const MATERIAL_KINDS = ['Matcap', 'Glass'] as const;
export const MATCAPS = ['Clay', 'Chrome', 'Jade', 'Ember'] as const;
export const ENVIRONMENTS = ['Dusk room', 'Night grid', 'Flat'] as const;
export const GRADIENT_TYPES = ['Linear', 'Radial'] as const;
export const PINNED_EDGES = ['Top', 'Left', 'Corners', 'None'] as const;
export const MODEL_PRESETS = ['Pebble', 'Arch', 'Lattice'] as const;

export const CHOICE_DISPLAY: Record<string, string> = {
  front: 'Front only',
  both: 'Both sides',
  emit: 'Emit',
  form: 'Form into',
  text: 'Text',
  svg: 'SVG',
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out',
  glide: 'Glide',
  anticipate: 'Anticipate',
  elastic: 'Elastic',
  bouncy: 'Bouncy',
  spring: 'Spring',
};

export function displayChoice(stored: string): string {
  return CHOICE_DISPLAY[stored] ?? stored;
}

export const TWO_D_KINDS: readonly LayerKind[] = [
  'Rectangle',
  'Ellipse',
  'Polygon',
  'Text',
  'Image',
  'Gradient',
];
export const THREE_D_KINDS: readonly LayerKind[] = [
  'Primitive',
  'Extrusion',
  'Model',
  'Particles',
  'Cloth',
];

export const is2D = (kind: LayerKind): boolean => TWO_D_KINDS.includes(kind);
export const is3D = (kind: LayerKind): boolean => THREE_D_KINDS.includes(kind);

const defs = {
  seeds: { particle: 7, cloth: 3, grain: 11 },
};

/** Seed defaults come from the environment; the server sets them at start. */
export function setSeedDefaults(seeds: { particle: number; cloth: number; grain: number }): void {
  defs.seeds = seeds;
}

function numberDef(
  path: string,
  field: string,
  min: number,
  max: number,
  step: number,
  shiftStep: number,
  value: number,
  overridable = true,
): PropDef {
  return { path, field, type: 'number', min, max, step, shiftStep, default: value, overridable };
}

const commonDefs = (): PropDef[] => [
  {
    path: 'visible',
    field: 'Visible',
    type: 'boolean',
    default: true,
    overridable: true,
  },
  { path: 'locked', field: 'Locked', type: 'boolean', default: false, overridable: false },
];

const eventDefs = (): PropDef[] => [
  { path: 'events.appear.enabled', field: 'Appear', type: 'boolean', default: false, overridable: true },
  numberDef('events.appear.durationMs', 'Appear duration', 0, 1000, 1, 10, 600),
  numberDef('events.appear.delayMs', 'Appear delay', 0, 2500, 1, 10, 0),
  {
    path: 'events.appear.easing',
    field: 'Appear easing',
    type: 'choice',
    choices: EVENT_EASINGS,
    default: 'glide',
    overridable: true,
  },
  { path: 'events.hover.enabled', field: 'Hover', type: 'boolean', default: false, overridable: true },
  numberDef('events.hover.durationMs', 'Hover duration', 0, 1000, 1, 10, 300),
  numberDef('events.hover.delayMs', 'Hover delay', 0, 2500, 1, 10, 0),
  {
    path: 'events.hover.easing',
    field: 'Hover easing',
    type: 'choice',
    choices: EVENT_EASINGS,
    default: 'glide',
    overridable: true,
  },
  {
    path: 'events.hover.forwardsOnly',
    field: 'Forwards only',
    type: 'boolean',
    default: false,
    overridable: true,
  },
  {
    path: 'events.tilt.enabled',
    field: 'Tilt toward cursor',
    type: 'boolean',
    default: false,
    overridable: true,
  },
  numberDef('events.tilt.maxTilt', 'Max tilt', 0, 45, 1, 5, 12),
  numberDef('events.tilt.sensitivity', 'Sensitivity', 0, 1, 0.05, 0.1, 1),
  numberDef('events.tilt.momentum', 'Momentum', 0, 1, 0.05, 0.1, 1),
  {
    path: 'events.scroll.enabled',
    field: 'Scroll into view',
    type: 'boolean',
    default: false,
    overridable: true,
  },
  numberDef('events.scroll.delayPct', 'Scroll delay', 0, 100, 1, 10, 0),
  numberDef('events.scroll.durationPct', 'Scroll duration', 1, 200, 1, 10, 50),
  {
    path: 'events.scroll.easing',
    field: 'Scroll easing',
    type: 'choice',
    choices: EVENT_EASINGS,
    default: 'glide',
    overridable: true,
  },
  { path: 'events.loop.enabled', field: 'Loop', type: 'boolean', default: false, overridable: true },
  numberDef('events.loop.loopDelayMs', 'Loop delay', 0, 5000, 1, 10, 0),
];

const twoDDefs = (): PropDef[] => [
  numberDef('x', 'X', -10000, 10000, 1, 10, 0),
  numberDef('y', 'Y', -10000, 10000, 1, 10, 0),
  numberDef('width', 'Width', 1, 10000, 1, 10, 200),
  numberDef('height', 'Height', 1, 10000, 1, 10, 200),
  numberDef('opacity', 'Opacity', 0, 100, 1, 10, 100),
  { path: 'fill', field: 'Fill', type: 'colour', default: '#FFFFFF', overridable: true },
  {
    path: 'blendMode',
    field: 'Blend mode',
    type: 'choice',
    choices: BLEND_MODES,
    default: 'Normal',
    overridable: false,
  },
  {
    path: 'maskAbove',
    field: 'Mask the layer above',
    type: 'boolean',
    default: false,
    overridable: false,
  },
];

const materialDefs = (): PropDef[] => [
  {
    path: 'material.kind',
    field: 'Material',
    type: 'choice',
    choices: MATERIAL_KINDS,
    default: 'Matcap',
    overridable: true,
  },
  {
    path: 'material.matcap',
    field: 'Matcap',
    type: 'choice',
    choices: MATCAPS,
    default: 'Clay',
    overridable: true,
  },
  { path: 'material.color', field: 'Colour', type: 'colour', default: '#FFFFFF', overridable: true },
  numberDef('material.opacity', 'Material opacity', 0, 1, 0.01, 0.1, 1),
  numberDef('material.refraction', 'Refraction strength', 0, 2, 0.05, 0.1, 1),
  {
    path: 'material.backFaceRefraction',
    field: 'Back-face refraction',
    type: 'boolean',
    default: false,
    overridable: true,
  },
  { path: 'depthTest', field: 'Depth testing', type: 'boolean', default: true, overridable: true },
  {
    path: 'faces',
    field: 'Faces',
    type: 'choice',
    choices: ['front', 'both'],
    default: 'front',
    overridable: true,
  },
];

const transformDefs = (): PropDef[] => [
  numberDef('position.x', 'Position X', -100, 100, 0.1, 1, 0),
  numberDef('position.y', 'Position Y', -100, 100, 0.1, 1, 0),
  numberDef('position.z', 'Position Z', -100, 100, 0.1, 1, 0),
  numberDef('rotation.x', 'Rotation X', -360, 360, 1, 15, 0),
  numberDef('rotation.y', 'Rotation Y', -360, 360, 1, 15, 0),
  numberDef('rotation.z', 'Rotation Z', -360, 360, 1, 15, 0),
  numberDef('scale.x', 'Scale X', 0.01, 100, 0.1, 1, 1),
  numberDef('scale.y', 'Scale Y', 0.01, 100, 0.1, 1, 1),
  numberDef('scale.z', 'Scale Z', 0.01, 100, 0.1, 1, 1),
];

export const EVENT_EASINGS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'glide',
  'anticipate',
  'elastic',
  'bouncy',
] as const;

const gradientDefs = (): PropDef[] => [
  {
    path: 'gradient.type',
    field: 'Gradient type',
    type: 'choice',
    choices: GRADIENT_TYPES,
    default: 'Linear',
    overridable: true,
  },
  numberDef('gradient.angle', 'Angle', 0, 359, 1, 15, 0),
  numberDef('gradient.centerX', 'Centre X', 0, 100, 1, 10, 50),
  numberDef('gradient.centerY', 'Centre Y', 0, 100, 1, 10, 50),
  numberDef('gradient.radius', 'Radius', 1, 10000, 1, 10, 100),
  {
    path: 'gradient.stops',
    field: 'Gradient stops',
    type: 'list',
    default: [
      { color: '#000000', position: 0 },
      { color: '#FFFFFF', position: 100 },
    ],
    overridable: true,
  },
];

const effectDefs = (): PropDef[] => [
  {
    path: 'effect.kind',
    field: 'Effect',
    type: 'choice',
    choices: EFFECT_KINDS,
    default: 'Blur',
    overridable: false,
  },
  { path: 'enabled', field: 'Enabled', type: 'boolean', default: true, overridable: true },
  numberDef('effect.blurRadius', 'Blur radius', 0, 50, 1, 10, 8),
  numberDef('effect.grainAmount', 'Grain amount', 0, 1, 0.01, 0.1, 0.15),
  numberDef('effect.grainSeed', 'Grain seed', -2147483648, 2147483647, 1, 10, defs.seeds.grain),
  numberDef('effect.bloomThreshold', 'Bloom threshold', 0, 1, 0.01, 0.1, 0.7),
  numberDef('effect.bloomIntensity', 'Bloom intensity', 0, 3, 0.1, 1, 1),
  numberDef('effect.bloomRadius', 'Bloom radius', 0, 50, 1, 10, 12),
  numberDef('effect.glowStrength', 'Glow strength', 0, 3, 0.1, 1, 1),
  numberDef('effect.glowThreshold', 'Glow threshold', 0, 1, 0.01, 0.1, 0.7),
  numberDef('effect.aberration', 'Aberration amount', 0, 20, 1, 10, 4),
  numberDef('effect.displacement', 'Displacement amount', 0, 100, 1, 10, 10),
  numberDef('effect.pixelCell', 'Pixel cell', 2, 64, 1, 10, 8),
];

const particleDefs = (): PropDef[] => [
  {
    path: 'mode',
    field: 'Particle mode',
    type: 'choice',
    choices: ['emit', 'form'],
    default: 'emit',
    overridable: true,
  },
  numberDef('seed', 'Particle seed', -2147483648, 2147483647, 1, 10, defs.seeds.particle),
  numberDef('rate', 'Rate', 0, 600, 1, 10, 30),
  numberDef('burst', 'Burst', 0, 500, 1, 10, 0),
  numberDef('lifetime', 'Lifetime', 0.1, 10, 0.1, 1, 2),
  numberDef('speed', 'Particle speed', 0, 20, 0.1, 1, 2),
  numberDef('gravity', 'Particle gravity', 0, 30, 0.1, 1, 9.8),
  numberDef('trailLength', 'Trail length', 0, 32, 1, 10, 0),
  numberDef('orbit', 'Orbit', -720, 720, 1, 15, 0),
  numberDef('attractor.x', 'Attractor X', -100, 100, 0.1, 1, 0),
  numberDef('attractor.y', 'Attractor Y', -100, 100, 0.1, 1, 0),
  numberDef('attractor.z', 'Attractor Z', -100, 100, 0.1, 1, 0),
  numberDef('attractor.strength', 'Attractor strength', 0, 20, 0.1, 1, 0),
  {
    path: 'formation.target',
    field: 'Form into',
    type: 'asset',
    default: null,
    overridable: true,
  },
  numberDef('formation.count', 'Count', 1, 2000, 1, 10, 200),
  numberDef('formation.durationMs', 'Formation duration', 100, 5000, 1, 10, 1500),
];

const clothDefs = (): PropDef[] => [
  numberDef('columns', 'Columns', 4, 20, 1, 1, 10),
  numberDef('rows', 'Rows', 4, 20, 1, 1, 10),
  {
    path: 'pinned',
    field: 'Pinned edge',
    type: 'choice',
    choices: PINNED_EDGES,
    default: 'Top',
    overridable: true,
  },
  numberDef('gravity', 'Cloth gravity', 0, 30, 0.1, 1, 9.8),
  numberDef('windStrength', 'Wind strength', 0, 20, 0.1, 1, 0),
  numberDef('windDirection', 'Wind direction', 0, 359, 1, 15, 0),
  numberDef('stiffness', 'Cloth stiffness', 0.1, 1, 0.01, 0.1, 1),
  numberDef('damping', 'Cloth damping', 0, 0.2, 0.01, 0.1, 0.02),
  numberDef('iterations', 'Constraint iterations', 1, 10, 1, 1, 3),
  numberDef('seed', 'Cloth seed', -2147483648, 2147483647, 1, 10, defs.seeds.cloth),
];

const extrusionDefs = (): PropDef[] => [
  {
    path: 'source',
    field: 'Source',
    type: 'choice',
    choices: ['text', 'svg'],
    default: 'text',
    overridable: false,
  },
  {
    path: 'text',
    field: 'Extrude text',
    type: 'text',
    maxLength: 200,
    default: 'HALO',
    overridable: true,
  },
  numberDef('letterHeight', 'Letter height', 0.1, 10, 0.1, 1, 1),
  { path: 'svgAssetId', field: 'SVG', type: 'asset', default: null, overridable: false },
  numberDef('depth', 'Extrude depth', 0.01, 10, 0.01, 0.1, 0.2),
  numberDef('bevelSize', 'Bevel size', 0, 0.5, 0.01, 0.1, 0),
  numberDef('bevelSegments', 'Bevel segments', 1, 4, 1, 1, 1),
];

export function layerPropDefs(kind: LayerKind): PropDef[] {
  const list: PropDef[] = [...commonDefs()];
  if (is2D(kind)) {
    list.push(...twoDDefs());
    if (kind === 'Polygon') list.push(numberDef('sides', 'Sides', 3, 12, 1, 1, 6));
    if (kind === 'Text') {
      list.push({
        path: 'text',
        field: 'Text',
        type: 'text',
        maxLength: 200,
        default: 'Text',
        overridable: true,
      });
      list.push(numberDef('textSize', 'Text size', 8, 400, 1, 10, 48));
    }
    if (kind === 'Image') {
      list.push({ path: 'assetId', field: 'Image', type: 'asset', default: null, overridable: false });
    }
    if (kind === 'Gradient') list.push(...gradientDefs());
  }
  if (kind === 'Effect') list.push(...effectDefs());
  if (is3D(kind)) {
    list.push(...transformDefs());
    list.push(...materialDefs());
  }
  if (kind === 'Primitive') {
    list.push({
      path: 'primitive',
      field: 'Primitive',
      type: 'choice',
      choices: PRIMITIVES,
      default: 'Cube',
      overridable: false,
    });
  }
  if (kind === 'Extrusion') list.push(...extrusionDefs());
  if (kind === 'Model') {
    list.push({
      path: 'modelAssetId',
      field: 'Model',
      type: 'asset',
      default: null,
      overridable: false,
    });
    list.push({
      path: 'preset',
      field: 'Preset model',
      type: 'choice',
      choices: MODEL_PRESETS,
      default: null,
      overridable: false,
    });
    list.push({ path: 'clips', field: 'Clips', type: 'list', default: [], overridable: true });
  }
  if (kind === 'Particles') list.push(...particleDefs());
  if (kind === 'Cloth') list.push(...clothDefs());
  list.push(...eventDefs());
  return list;
}

export function scenePropDefs(): PropDef[] {
  return [
    { path: 'background', field: 'Background', type: 'colour', default: '#0B0B0E', overridable: true },
    {
      path: 'environment',
      field: 'Environment',
      type: 'choice',
      choices: ENVIRONMENTS,
      default: 'Flat',
      overridable: true,
    },
    numberDef('durationMs', 'Duration', 500, 60000, 1, 10, 5000),
    numberDef('camera.fov', 'Field of view', 10, 120, 1, 10, 50),
    numberDef('camera.position.x', 'Camera position X', -1000, 1000, 0.1, 1, 0),
    numberDef('camera.position.y', 'Camera position Y', -1000, 1000, 0.1, 1, 0),
    numberDef('camera.position.z', 'Camera position Z', -1000, 1000, 0.1, 1, 10),
    numberDef('camera.target.x', 'Camera target X', -1000, 1000, 0.1, 1, 0),
    numberDef('camera.target.y', 'Camera target Y', -1000, 1000, 0.1, 1, 0),
    numberDef('camera.target.z', 'Camera target Z', -1000, 1000, 0.1, 1, 0),
    numberDef('camera.near', 'Near', 0.01, 10, 0.01, 0.1, 0.1),
    numberDef('camera.far', 'Far', 1, 1000, 1, 10, 100),
    { path: 'orbit.enabled', field: 'Scroll orbit', type: 'boolean', default: false, overridable: true },
    numberDef('orbit.startAngle', 'Start angle', -360, 360, 1, 15, 0),
    numberDef('orbit.endAngle', 'End angle', -360, 360, 1, 15, 90),
    { path: 'light.enabled', field: 'Light field', type: 'boolean', default: true, overridable: true },
    numberDef('light.sensitivity', 'Light sensitivity', 0, 1, 0.05, 0.1, 1),
    numberDef('light.momentum', 'Light momentum', 0, 1, 0.05, 0.1, 1),
  ];
}

const layerDefCache = new Map<LayerKind, Map<string, PropDef>>();

export function layerPropDef(kind: LayerKind, path: string): PropDef | undefined {
  let map = layerDefCache.get(kind);
  if (!map) {
    map = new Map(layerPropDefs(kind).map((def) => [def.path, def]));
    layerDefCache.set(kind, map);
  }
  return map.get(path);
}

let sceneDefMap: Map<string, PropDef> | null = null;

export function scenePropDef(path: string): PropDef | undefined {
  if (!sceneDefMap) sceneDefMap = new Map(scenePropDefs().map((def) => [def.path, def]));
  return sceneDefMap.get(path);
}

export function clearPropCaches(): void {
  layerDefCache.clear();
  sceneDefMap = null;
}

/** Layer fields stored at the top level of the layer record rather than under props. */
export const TOP_LEVEL_LAYER_PATHS = ['name', 'visible', 'locked', 'maskAbove', 'blendMode'];

export function readPath(root: JsonObject, path: string): JsonValue | undefined {
  const parts = path.split('.');
  let current: JsonValue | undefined = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as JsonObject)[part];
  }
  return current;
}

export function writePath(root: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split('.');
  let current: JsonObject = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = current[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as JsonObject;
  }
  current[parts[parts.length - 1]] = value;
}

const VECTOR_GROUPS = ['position', 'rotation', 'scale'];

/** The leaf paths a vector variable binding covers, or null when the property is not a vector. */
export function vectorGroupAxes(property: string, kind: LayerKind): string[] | null {
  if (is3D(kind) && VECTOR_GROUPS.includes(property)) {
    return [`${property}.x`, `${property}.y`, `${property}.z`];
  }
  if (is2D(kind) && property === 'position') return ['x', 'y'];
  return null;
}

export function groupPathOf(path: string): string | null {
  if (path === 'x' || path === 'y') return 'position';
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  const head = path.slice(0, dot);
  return VECTOR_GROUPS.includes(head) ? head : null;
}
