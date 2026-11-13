import { getPath, setPath } from './paths';
import {
  BLEND_MODES,
  EASING_LABELS,
  EASING_NAMES,
  EFFECT_KINDS,
  ENVIRONMENTS,
  type EffectKind,
  type Json,
  type JsonObject,
  type LayerKind,
  type Seeds,
} from './types';

export type Control = 'spin' | 'text' | 'colour' | 'switch' | 'select' | 'radio' | 'custom';

export interface Choice {
  value: string;
  label: string;
}

export interface PropertyDef {
  path: string;
  label: string;
  control: Control;
  min?: number;
  max?: number;
  step?: number;
  shiftStep?: number;
  integer?: boolean;
  maxLength?: number;
  choices?: readonly Choice[];
  default: Json | ((seeds: Seeds) => Json);
  overridable: boolean;
  keyframeable: boolean;
}

const EASING_CHOICES: Choice[] = EASING_NAMES.map((value) => ({ value, label: EASING_LABELS[value] }));
const same = (values: readonly string[]): Choice[] => values.map((value) => ({ value, label: value }));

const spin = (
  path: string,
  label: string,
  min: number,
  max: number,
  step: number,
  shiftStep: number,
  defaultValue: Json | ((seeds: Seeds) => Json),
  options: { integer?: boolean; keyframeable?: boolean; overridable?: boolean } = {},
): PropertyDef => ({
  path,
  label,
  control: 'spin',
  min,
  max,
  step,
  shiftStep,
  integer: options.integer ?? false,
  default: defaultValue,
  overridable: options.overridable ?? true,
  keyframeable: options.keyframeable ?? true,
});

const choice = (
  path: string,
  label: string,
  choices: readonly Choice[],
  defaultValue: string,
  control: 'select' | 'radio' = 'select',
  overridable = true,
): PropertyDef => ({ path, label, control, choices, default: defaultValue, overridable, keyframeable: false });

const toggle = (path: string, label: string, defaultValue: boolean, overridable = true): PropertyDef => ({
  path,
  label,
  control: 'switch',
  default: defaultValue,
  overridable,
  keyframeable: false,
});

const colour = (path: string, label: string, defaultValue: string): PropertyDef => ({
  path,
  label,
  control: 'colour',
  default: defaultValue,
  overridable: true,
  keyframeable: false,
});

const text = (path: string, label: string, defaultValue: string, maxLength: number): PropertyDef => ({
  path,
  label,
  control: 'text',
  maxLength,
  default: defaultValue,
  overridable: true,
  keyframeable: false,
});

const custom = (path: string, label: string, defaultValue: Json, overridable = true): PropertyDef => ({
  path,
  label,
  control: 'custom',
  default: defaultValue,
  overridable,
  keyframeable: false,
});

const axes = (
  base: string,
  label: string,
  min: number,
  max: number,
  step: number,
  shiftStep: number,
  defaults: [number, number, number],
): PropertyDef[] =>
  (['x', 'y', 'z'] as const).map((axis, i) =>
    spin(`${base}.${axis}`, `${label} ${axis.toUpperCase()}`, min, max, step, shiftStep, defaults[i] as number),
  );

const DEFAULT_GRADIENT_STOPS: Json = [
  { color: '#8E6CF2', position: 0 },
  { color: '#0B0B0E', position: 100 },
];

const FLAT_BOX: PropertyDef[] = [
  spin('x', 'X', -10000, 10000, 1, 10, 0),
  spin('y', 'Y', -10000, 10000, 1, 10, 0),
  spin('width', 'Width', 1, 10000, 1, 10, 200),
  spin('height', 'Height', 1, 10000, 1, 10, 200),
  spin('opacity', 'Opacity', 0, 100, 1, 10, 100),
];

const FILL = colour('fill', 'Fill', '#FFFFFF');

const EFFECT_PARAMETERS: Record<EffectKind, PropertyDef[]> = {
  Blur: [spin('effect.blurRadius', 'Blur radius', 0, 50, 1, 10, 8)],
  Grain: [
    spin('effect.grainAmount', 'Grain amount', 0, 1, 0.01, 0.1, 0.15),
    spin('effect.grainSeed', 'Grain seed', -2147483648, 2147483647, 1, 10, (seeds) => seeds.grain, {
      integer: true,
      keyframeable: false,
    }),
  ],
  Bloom: [
    spin('effect.bloomThreshold', 'Bloom threshold', 0, 1, 0.01, 0.1, 0.7),
    spin('effect.bloomIntensity', 'Bloom intensity', 0, 3, 0.1, 1, 1),
    spin('effect.bloomRadius', 'Bloom radius', 0, 50, 1, 10, 12),
  ],
  Glow: [
    spin('effect.glowStrength', 'Glow strength', 0, 3, 0.1, 1, 1),
    spin('effect.glowThreshold', 'Glow threshold', 0, 1, 0.01, 0.1, 0.7),
  ],
  'Chromatic aberration': [spin('effect.aberration', 'Aberration amount', 0, 20, 1, 5, 4)],
  Displacement: [
    spin('effect.displacement', 'Displacement amount', 0, 100, 1, 10, 10),
    spin('effect.grainSeed', 'Grain seed', -2147483648, 2147483647, 1, 10, (seeds) => seeds.grain, {
      integer: true,
      keyframeable: false,
    }),
  ],
  Pixelate: [spin('effect.pixelCell', 'Pixel cell', 2, 64, 1, 8, 8)],
};

const MATCAPS = ['Clay', 'Chrome', 'Jade', 'Ember'] as const;
const MATERIAL_KINDS = ['Matcap', 'Glass'] as const;
export const GLASS_DEFAULTS = { color: '#B7A4FF', opacity: 0.35 } as const;
export const MATCAP_DEFAULTS = { color: '#FFFFFF', opacity: 1 } as const;

const TRANSFORM: PropertyDef[] = [
  ...axes('position', 'Position', -100, 100, 0.1, 1, [0, 0, 0]),
  ...axes('rotation', 'Rotation', -360, 360, 1, 15, [0, 0, 0]),
  ...axes('scale', 'Scale', 0.01, 100, 0.1, 1, [1, 1, 1]),
];

const MATERIAL: PropertyDef[] = [
  choice('material.kind', 'Material', same(MATERIAL_KINDS), 'Matcap'),
  choice('material.matcap', 'Matcap', same(MATCAPS), 'Clay'),
  colour('material.color', 'Colour', MATCAP_DEFAULTS.color),
  spin('material.opacity', 'Material opacity', 0, 1, 0.01, 0.1, MATCAP_DEFAULTS.opacity),
  spin('material.refraction', 'Refraction strength', 0, 2, 0.05, 0.5, 1),
  toggle('material.backFaceRefraction', 'Back-face refraction', false),
  toggle('depthTest', 'Depth testing', true),
  choice(
    'faces',
    'Faces',
    [
      { value: 'front', label: 'Front only' },
      { value: 'both', label: 'Both sides' },
    ],
    'front',
    'radio',
  ),
];

const SOLID_BASE: PropertyDef[] = [...TRANSFORM, ...MATERIAL];

const PARTICLES: PropertyDef[] = [
  choice(
    'mode',
    'Particle mode',
    [
      { value: 'emit', label: 'Emit' },
      { value: 'form', label: 'Form into' },
    ],
    'emit',
    'radio',
  ),
  spin('seed', 'Particle seed', -2147483648, 2147483647, 1, 10, (seeds) => seeds.particle, {
    integer: true,
    keyframeable: false,
  }),
  spin('rate', 'Rate', 0, 600, 1, 10, 30),
  spin('burst', 'Burst', 0, 500, 1, 10, 0),
  spin('lifetime', 'Lifetime', 0.1, 10, 0.1, 1, 2),
  spin('speed', 'Particle speed', 0, 20, 0.1, 1, 2),
  spin('gravity', 'Particle gravity', 0, 30, 0.1, 1, 9.8),
  spin('trailLength', 'Trail length', 0, 32, 1, 4, 0, { integer: true }),
  spin('orbit', 'Orbit', -720, 720, 1, 10, 0),
  ...axes('attractor', 'Attractor', -100, 100, 0.1, 1, [0, 0, 0]),
  spin('attractor.strength', 'Attractor strength', 0, 20, 0.1, 1, 0),
  custom('formation.target', 'Form into', null, false),
  spin('formation.count', 'Count', 1, 2000, 1, 100, 200, { integer: true, keyframeable: false }),
  spin('formation.durationMs', 'Formation duration', 100, 5000, 1, 100, 1500),
];

const CLOTH: PropertyDef[] = [
  spin('columns', 'Columns', 4, 20, 1, 5, 10, { integer: true, keyframeable: false }),
  spin('rows', 'Rows', 4, 20, 1, 5, 10, { integer: true, keyframeable: false }),
  choice('pinned', 'Pinned edge', same(['Top', 'Left', 'Corners', 'None']), 'Top'),
  spin('gravity', 'Cloth gravity', 0, 30, 0.1, 1, 9.8),
  spin('windStrength', 'Wind strength', 0, 20, 0.1, 1, 0),
  spin('windDirection', 'Wind direction', 0, 359, 1, 15, 0),
  spin('stiffness', 'Cloth stiffness', 0.1, 1, 0.01, 0.1, 1),
  spin('damping', 'Cloth damping', 0, 0.2, 0.01, 0.05, 0.02),
  spin('iterations', 'Constraint iterations', 1, 10, 1, 2, 3, { integer: true, keyframeable: false }),
  spin('seed', 'Cloth seed', -2147483648, 2147483647, 1, 10, (seeds) => seeds.cloth, {
    integer: true,
    keyframeable: false,
  }),
];

const EXTRUSION: PropertyDef[] = [
  choice('source', 'Source', same(['text', 'svg']), 'text', 'select', false),
  text('text', 'Extrude text', 'HALO', 200),
  spin('letterHeight', 'Letter height', 0.1, 10, 0.1, 1, 1),
  custom('svgAssetId', 'SVG', null, false),
  spin('depth', 'Extrude depth', 0.01, 10, 0.01, 0.1, 0.2),
  spin('bevelSize', 'Bevel size', 0, 0.5, 0.01, 0.1, 0),
  spin('bevelSegments', 'Bevel segments', 1, 4, 1, 1, 1, { integer: true, keyframeable: false }),
];

const MODEL: PropertyDef[] = [custom('modelAssetId', 'Model', null, false), custom('preset', 'Preset', null, false), custom('clips', 'Clips', [])];

const PRIMITIVE: PropertyDef[] = [
  choice('primitive', 'Primitive', same(['Cube', 'Sphere', 'Cylinder', 'Torus', 'Plane']), 'Cube', 'select', false),
];

export const CLIP_SPEED = { min: 0.25, max: 4, step: 0.25, shiftStep: 1 } as const;
export const CLIP_OFFSET = { min: 0, max: 60000, step: 10, shiftStep: 100 } as const;

export const EVENT_PROPERTIES: PropertyDef[] = [
  toggle('events.tilt.enabled', 'Tilt toward cursor', false),
  spin('events.tilt.maxTilt', 'Max tilt', 0, 45, 1, 5, 12),
  spin('events.tilt.sensitivity', 'Sensitivity', 0, 1, 0.05, 0.25, 1),
  spin('events.tilt.momentum', 'Momentum', 0, 1, 0.05, 0.25, 1),
  toggle('events.appear.enabled', 'Appear', false),
  spin('events.appear.durationMs', 'Appear duration', 0, 1000, 1, 100, 600),
  spin('events.appear.delayMs', 'Appear delay', 0, 2500, 1, 100, 0),
  choice('events.appear.easing', 'Appear easing', EASING_CHOICES, 'glide'),
  custom('events.appear.from', 'Appear from', {}),
  toggle('events.hover.enabled', 'Hover', false),
  spin('events.hover.durationMs', 'Hover duration', 0, 1000, 1, 100, 300),
  spin('events.hover.delayMs', 'Hover delay', 0, 2500, 1, 100, 0),
  choice('events.hover.easing', 'Hover easing', EASING_CHOICES, 'glide'),
  toggle('events.hover.forwardsOnly', 'Forwards only', false),
  custom('events.hover.to', 'Hover to', {}),
  toggle('events.scroll.enabled', 'Scroll into view', false),
  spin('events.scroll.delayPct', 'Scroll delay', 0, 100, 1, 10, 0),
  spin('events.scroll.durationPct', 'Scroll duration', 1, 200, 1, 10, 50),
  choice('events.scroll.easing', 'Scroll easing', EASING_CHOICES, 'glide'),
  custom('events.scroll.from', 'Scroll from', {}),
  toggle('events.loop.enabled', 'Loop', false),
  spin('events.loop.loopDelayMs', 'Loop delay', 0, 5000, 1, 100, 0),
];

export const SCENE_PROPERTIES: PropertyDef[] = [
  colour('background', 'Background', '#0B0B0E'),
  choice('environment', 'Environment', same(ENVIRONMENTS), 'Flat', 'select', false),
  spin('durationMs', 'Duration', 500, 60000, 1, 1000, 5000, { keyframeable: false, overridable: false }),
  spin('camera.fov', 'Field of view', 10, 120, 1, 10, 50),
  ...axes('camera.position', 'Camera position', -1000, 1000, 0.1, 1, [0, 0, 10]),
  ...axes('camera.target', 'Camera target', -1000, 1000, 0.1, 1, [0, 0, 0]),
  spin('camera.near', 'Near', 0.01, 10, 0.01, 0.1, 0.1),
  spin('camera.far', 'Far', 1, 1000, 1, 10, 100),
  toggle('orbit.enabled', 'Scroll orbit', false),
  spin('orbit.startAngle', 'Start angle', -360, 360, 1, 15, 0),
  spin('orbit.endAngle', 'End angle', -360, 360, 1, 15, 90),
  toggle('light.enabled', 'Light field', true, false),
  spin('light.sensitivity', 'Light sensitivity', 0, 1, 0.05, 0.25, 1, { overridable: false, keyframeable: false }),
  spin('light.momentum', 'Light momentum', 0, 1, 0.05, 0.25, 1, { overridable: false, keyframeable: false }),
].map((def) => (def.path === 'background' || def.path === 'environment' ? { ...def, overridable: false } : def));

/** Layer fields that live next to `props` rather than inside it. */
export const LAYER_FIELDS: PropertyDef[] = [
  { ...text('name', 'Name', '', 60), overridable: false },
  toggle('visible', 'Visible', true),
  toggle('locked', 'Locked', false, false),
  toggle('maskAbove', 'Mask the layer above', false, false),
  choice('blendMode', 'Blend mode', same(BLEND_MODES), 'Normal', 'select', false),
];

export const GRADIENT_PROPERTIES: PropertyDef[] = [
  choice('gradient.type', 'Gradient type', same(['Linear', 'Radial']), 'Linear'),
  spin('gradient.angle', 'Angle', 0, 359, 1, 15, 0),
  spin('gradient.centerX', 'Centre X', 0, 100, 1, 10, 50),
  spin('gradient.centerY', 'Centre Y', 0, 100, 1, 10, 50),
  spin('gradient.radius', 'Radius', 1, 10000, 1, 10, 100),
  custom('gradient.stops', 'Gradient stops', DEFAULT_GRADIENT_STOPS),
];

const EFFECT_COMMON: PropertyDef[] = [
  choice('effect.kind', 'Effect', same(EFFECT_KINDS), 'Blur', 'select', false),
  toggle('effect.enabled', 'Enabled', true),
];

export interface PropertySource {
  kind: LayerKind;
  props: JsonObject;
}

/** The properties of a layer, in inspector order, excluding top-level fields and events. */
export function layerProperties(layer: PropertySource): PropertyDef[] {
  switch (layer.kind) {
    case 'Rectangle':
    case 'Ellipse':
      return [...FLAT_BOX, FILL];
    case 'Polygon':
      return [...FLAT_BOX, FILL, spin('sides', 'Sides', 3, 12, 1, 1, 6, { integer: true, keyframeable: false })];
    case 'Text':
      return [...FLAT_BOX, FILL, text('text', 'Text', 'Text', 200), spin('textSize', 'Text size', 8, 400, 1, 10, 48)];
    case 'Image':
      return [...FLAT_BOX, custom('assetId', 'Image', null, false)];
    case 'Gradient':
      return [...FLAT_BOX, ...GRADIENT_PROPERTIES];
    case 'Effect': {
      const effect = layer.props['effect'];
      const kind =
        typeof effect === 'object' && effect !== null && !Array.isArray(effect) && typeof effect['kind'] === 'string'
          ? (effect['kind'] as EffectKind)
          : 'Blur';
      return [...EFFECT_COMMON, ...(EFFECT_PARAMETERS[kind] ?? [])];
    }
    case 'Primitive':
      return [...PRIMITIVE, ...SOLID_BASE];
    case 'Extrusion':
      return [...EXTRUSION, ...SOLID_BASE];
    case 'Model':
      return [...MODEL, ...SOLID_BASE];
    case 'Particles':
      return [...PARTICLES, ...SOLID_BASE];
    case 'Cloth':
      return [...CLOTH, ...SOLID_BASE];
    case 'Group':
      return [];
  }
}

export function appliesEvents(kind: LayerKind): boolean {
  return kind !== 'Group';
}

/** Every definition addressable by `updateLayer` on this layer, with its owning section. */
export function layerDefinitions(layer: PropertySource): PropertyDef[] {
  return [...LAYER_FIELDS, ...layerProperties(layer), ...(appliesEvents(layer.kind) ? EVENT_PROPERTIES : [])];
}

export function findLayerDefinition(layer: PropertySource, path: string): PropertyDef | undefined {
  return layerDefinitions(layer).find((def) => def.path === path);
}

export function findSceneDefinition(path: string): PropertyDef | undefined {
  return SCENE_PROPERTIES.find((def) => def.path === path);
}

export function defaultOf(def: PropertyDef, seeds: Seeds): Json {
  return typeof def.default === 'function' ? def.default(seeds) : structuredClone(def.default);
}

/** Builds the nested `props` of a fresh layer with every default filled in. */
export function defaultProps(kind: LayerKind, seeds: Seeds, initial: JsonObject = {}): JsonObject {
  const props: JsonObject = {};
  for (const [path, value] of Object.entries(initial)) setPath(props, path, value);
  for (const def of layerProperties({ kind, props })) {
    const given = getPath(initial, def.path);
    if (given === undefined && getPath(props, def.path) === undefined) setPath(props, def.path, defaultOf(def, seeds));
  }
  if (getPath(props, 'material.kind') === 'Glass') {
    if (getPath(initial, 'material.color') === undefined) setPath(props, 'material.color', GLASS_DEFAULTS.color);
    if (getPath(initial, 'material.opacity') === undefined) setPath(props, 'material.opacity', GLASS_DEFAULTS.opacity);
  }
  return props;
}

export function defaultEvents(seeds: Seeds): JsonObject {
  const events: JsonObject = {};
  for (const def of EVENT_PROPERTIES) setPath(events, def.path.slice('events.'.length), defaultOf(def, seeds));
  return events;
}
