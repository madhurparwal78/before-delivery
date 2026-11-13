// Property table: ranges, steps, defaults, and per-kind property construction.
import type {
  Breakpoint,
  ClipSetting,
  EffectKind,
  GradientStop,
  Layer,
  LayerKind,
  ModelPreset,
  PrimitiveKind,
  SceneBundle,
  SceneDocument,
  Vec3,
} from './types.js';

export interface FieldSpec {
  min: number;
  max: number;
  step: number;
  shiftStep: number;
  int?: boolean;
}

export const RANGE: Record<string, FieldSpec> = {
  x2d: { min: -10000, max: 10000, step: 1, shiftStep: 10 },
  size: { min: 1, max: 10000, step: 1, shiftStep: 10 },
  opacityPct: { min: 0, max: 100, step: 1, shiftStep: 10 },
  sides: { min: 3, max: 12, step: 1, shiftStep: 1, int: true },
  textSize: { min: 8, max: 400, step: 1, shiftStep: 10 },
  gradientAngle: { min: 0, max: 359, step: 1, shiftStep: 15 },
  gradientPos: { min: 0, max: 100, step: 1, shiftStep: 1 },
  gradientRadius: { min: 1, max: 10000, step: 1, shiftStep: 1 },
  pos: { min: -100, max: 100, step: 0.1, shiftStep: 1 },
  rot: { min: -360, max: 360, step: 1, shiftStep: 15 },
  scale: { min: 0.01, max: 100, step: 0.1, shiftStep: 1 },
  matOpacity: { min: 0, max: 1, step: 0.01, shiftStep: 0.01 },
  refraction: { min: 0, max: 2, step: 0.05, shiftStep: 0.05 },
  blurRadius: { min: 0, max: 50, step: 1, shiftStep: 1 },
  grainAmount: { min: 0, max: 1, step: 0.01, shiftStep: 0.01 },
  seed: { min: 0, max: 2147483647, step: 1, shiftStep: 1, int: true },
  bloomThreshold: { min: 0, max: 1, step: 0.01, shiftStep: 0.01 },
  bloomIntensity: { min: 0, max: 3, step: 0.1, shiftStep: 0.1 },
  bloomRadius: { min: 0, max: 50, step: 1, shiftStep: 1 },
  glowStrength: { min: 0, max: 3, step: 0.1, shiftStep: 0.1 },
  glowThreshold: { min: 0, max: 1, step: 0.01, shiftStep: 0.01 },
  aberration: { min: 0, max: 20, step: 1, shiftStep: 1 },
  displacement: { min: 0, max: 100, step: 1, shiftStep: 1 },
  pixelCell: { min: 2, max: 64, step: 1, shiftStep: 1 },
  letterHeight: { min: 0.1, max: 10, step: 0.1, shiftStep: 0.1 },
  extrudeDepth: { min: 0.01, max: 10, step: 0.01, shiftStep: 0.1 },
  bevelSize: { min: 0, max: 0.5, step: 0.01, shiftStep: 0.01 },
  bevelSegments: { min: 1, max: 4, step: 1, shiftStep: 1, int: true },
  clipSpeed: { min: 0.25, max: 4, step: 0.25, shiftStep: 0.25 },
  clipOffset: { min: 0, max: 60000, step: 1, shiftStep: 1, int: true },
  pRate: { min: 0, max: 600, step: 1, shiftStep: 1 },
  pBurst: { min: 0, max: 500, step: 1, shiftStep: 1 },
  pLifetime: { min: 0.1, max: 10, step: 0.1, shiftStep: 0.1 },
  pSpeed: { min: 0, max: 20, step: 0.1, shiftStep: 0.1 },
  pGravity: { min: 0, max: 30, step: 0.1, shiftStep: 0.1 },
  pTrail: { min: 0, max: 32, step: 1, shiftStep: 1, int: true },
  pOrbit: { min: -720, max: 720, step: 1, shiftStep: 1 },
  pAttr: { min: -100, max: 100, step: 0.1, shiftStep: 1 },
  pAttrStrength: { min: 0, max: 20, step: 0.1, shiftStep: 0.1 },
  pCount: { min: 1, max: 2000, step: 1, shiftStep: 1, int: true },
  pDuration: { min: 100, max: 5000, step: 1, shiftStep: 1, int: true },
  clothCR: { min: 4, max: 20, step: 1, shiftStep: 1, int: true },
  clothGravity: { min: 0, max: 30, step: 0.1, shiftStep: 0.1 },
  clothWind: { min: 0, max: 20, step: 0.1, shiftStep: 0.1 },
  clothWindDir: { min: 0, max: 359, step: 1, shiftStep: 1 },
  clothStiff: { min: 0.1, max: 1, step: 0.01, shiftStep: 0.01 },
  clothDamp: { min: 0, max: 0.2, step: 0.01, shiftStep: 0.01 },
  clothIter: { min: 1, max: 10, step: 1, shiftStep: 1, int: true },
  appearDur: { min: 0, max: 1000, step: 1, shiftStep: 1, int: true },
  appearDelay: { min: 0, max: 2500, step: 1, shiftStep: 1, int: true },
  hoverDur: { min: 0, max: 1000, step: 1, shiftStep: 1, int: true },
  hoverDelay: { min: 0, max: 2500, step: 1, shiftStep: 1, int: true },
  maxTilt: { min: 0, max: 45, step: 1, shiftStep: 1 },
  tiltSens: { min: 0, max: 1, step: 0.05, shiftStep: 0.05 },
  tiltMomentum: { min: 0, max: 1, step: 0.05, shiftStep: 0.05 },
  scrollDelay: { min: 0, max: 100, step: 1, shiftStep: 1 },
  scrollDuration: { min: 1, max: 200, step: 1, shiftStep: 1 },
  loopDelay: { min: 0, max: 5000, step: 1, shiftStep: 1, int: true },
  fov: { min: 10, max: 120, step: 1, shiftStep: 1 },
  camPos: { min: -1000, max: 1000, step: 0.1, shiftStep: 1 },
  near: { min: 0.01, max: 10, step: 0.01, shiftStep: 0.1 },
  far: { min: 1, max: 1000, step: 1, shiftStep: 10 },
  angle: { min: -360, max: 360, step: 1, shiftStep: 15 },
  lightSens: { min: 0, max: 1, step: 0.05, shiftStep: 0.05 },
  lightMomentum: { min: 0, max: 1, step: 0.05, shiftStep: 0.05 },
  durationMs: { min: 500, max: 60000, step: 100, shiftStep: 100, int: true },
  springStiff: { min: 1, max: 1000, step: 1, shiftStep: 10 },
  springDamp: { min: 0, max: 100, step: 1, shiftStep: 10 },
  springMass: { min: 0.1, max: 10, step: 0.1, shiftStep: 1 },
  sampleXY: { min: -10000, max: 10000, step: 1, shiftStep: 1 },
};

export const ARTBOARDS: Record<Breakpoint, { w: number; h: number }> = {
  desktop: { w: 1440, h: 810 },
  tablet: { w: 834, h: 1112 },
  mobile: { w: 390, h: 844 },
};

export function artboardForViewportWidth(w: number): Breakpoint {
  if (w >= 1024) return 'desktop';
  if (w >= 640) return 'tablet';
  return 'mobile';
}

export const EFFECT_PARAMS: Record<EffectKind, { path: string; rangeKey: string }[]> = {
  Blur: [{ path: 'blurRadius', rangeKey: 'blurRadius' }],
  Grain: [
    { path: 'grainAmount', rangeKey: 'grainAmount' },
    { path: 'grainSeed', rangeKey: 'seed' },
  ],
  Bloom: [
    { path: 'bloomThreshold', rangeKey: 'bloomThreshold' },
    { path: 'bloomIntensity', rangeKey: 'bloomIntensity' },
    { path: 'bloomRadius', rangeKey: 'bloomRadius' },
  ],
  Glow: [
    { path: 'glowStrength', rangeKey: 'glowStrength' },
    { path: 'glowThreshold', rangeKey: 'glowThreshold' },
  ],
  'Chromatic aberration': [{ path: 'aberration', rangeKey: 'aberration' }],
  Displacement: [{ path: 'displacement', rangeKey: 'displacement' }],
  Pixelate: [{ path: 'pixelCell', rangeKey: 'pixelCell' }],
};

export const EFFECT_DEFAULTS: Record<EffectKind, Record<string, number>> = {
  Blur: { blurRadius: 8 },
  Grain: { grainAmount: 0.15, grainSeed: 11 },
  Bloom: { bloomThreshold: 0.7, bloomIntensity: 1, bloomRadius: 12 },
  Glow: { glowStrength: 1, glowThreshold: 0.7 },
  'Chromatic aberration': { aberration: 4 },
  Displacement: { displacement: 10 },
  Pixelate: { pixelCell: 8 },
};

export const EFFECT_FIELD_LABELS: Record<EffectKind, Record<string, string>> = {
  Blur: { blurRadius: 'Blur radius' },
  Grain: { grainAmount: 'Grain amount', grainSeed: 'Grain seed' },
  Bloom: {
    bloomThreshold: 'Bloom threshold',
    bloomIntensity: 'Bloom intensity',
    bloomRadius: 'Bloom radius',
  },
  Glow: { glowStrength: 'Glow strength', glowThreshold: 'Glow threshold' },
  'Chromatic aberration': { aberration: 'Aberration amount' },
  Displacement: { displacement: 'Displacement amount' },
  Pixelate: { pixelCell: 'Pixel cell' },
};

export interface DomainLimits {
  particleSeed: number;
  clothSeed: number;
  grainSeed: number;
  particleMax: number;
}

export const DEFAULT_LIMITS: DomainLimits = {
  particleSeed: 7,
  clothSeed: 3,
  grainSeed: 11,
  particleMax: 2000,
};

export const MATERIAL_DEFAULTS = {
  Matcap: { color: '#FFFFFF', opacity: 1 },
  Glass: { color: '#B7A4FF', opacity: 0.35 },
};

function common3D(p: Record<string, unknown>): void {
  p.position = { x: 0, y: 0, z: 0 };
  p.rotation = { x: 0, y: 0, z: 0 };
  p.scale = { x: 1, y: 1, z: 1 };
  p.material = {
    kind: 'Matcap',
    matcap: 'Clay',
    color: '#FFFFFF',
    opacity: 1,
    refraction: 1,
    backFaceRefraction: false,
  };
  p.depthTest = true;
  p.faces = 'front';
}

export function makeDefaultProps(
  kind: LayerKind,
  preset: ModelPreset | null,
  limits: DomainLimits,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  switch (kind) {
    case 'Rectangle':
    case 'Ellipse':
      p.x = 0; p.y = 0; p.width = 200; p.height = 200; p.opacity = 100; p.fill = '#FFFFFF';
      break;
    case 'Polygon':
      p.x = 0; p.y = 0; p.width = 200; p.height = 200; p.opacity = 100; p.fill = '#FFFFFF'; p.sides = 6;
      break;
    case 'Text':
      p.x = 0; y2d(p);
      break;
    case 'Image':
      p.x = 0; y2d(p);
      p.imageAssetId = null;
      break;
    case 'Gradient':
      y2d(p);
      p.gradient = defaultGradient();
      break;
    case 'Effect':
      p.effect = { kind: 'Blur', enabled: true, blurRadius: 8 };
      break;
    case 'Primitive':
      common3D(p);
      p.primitive = 'Cube';
      break;
    case 'Extrusion':
      common3D(p);
      p.source = 'text';
      p.text = '';
      p.letterHeight = 1;
      p.svgAssetId = null;
      p.depth = 0.2;
      p.bevelSize = 0;
      p.bevelSegments = 1;
      break;
    case 'Model':
      common3D(p);
      p.modelAssetId = null;
      p.preset = preset;
      p.clips = [] as ClipSetting[];
      break;
    case 'Particles':
      common3D(p);
      p.mode = 'emit';
      p.seed = limits.particleSeed;
      p.rate = 30; p.burst = 0; p.lifetime = 2; p.speed = 2; p.gravity = 9.8;
      p.trailLength = 0; p.orbit = 0;
      p.attractor = { x: 0, y: 0, z: 0, strength: 0 };
      p.formation = { target: null, count: 200, durationMs: 1500 };
      break;
    case 'Cloth':
      common3D(p);
      p.columns = 10; p.rows = 10; p.pinned = 'Top';
      p.clothGravity = 9.8; p.windStrength = 0; p.windDirection = 0;
      p.stiffness = 1; p.damping = 0.02; p.iterations = 3;
      p.clothSeed = limits.clothSeed;
      break;
    case 'Group':
      break;
  }
  return p;
}

function y2d(p: Record<string, unknown>): void {
  p.y = 0;
  p.width = 200; p.height = 200; p.opacity = 100;
}

function defaultGradient(): {
  type: string;
  angle: number;
  centerX: number;
  centerY: number;
  radius: number;
  stops: GradientStop[];
} {
  return {
    type: 'Linear',
    angle: 0,
    centerX: 50,
    centerY: 50,
    radius: 100,
    stops: [
      { color: '#FFFFFF', position: 0 },
      { color: '#000000', position: 100 },
    ],
  };
}

export function makeLayer(
  id: string,
  kind: LayerKind,
  name: string,
  opts: { preset?: ModelPreset | null; limits?: DomainLimits } = {},
): Layer {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const props = makeDefaultProps(kind, opts.preset ?? null, limits);
  return {
    id,
    name,
    kind,
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    maskAbove: false,
    blendMode: 'Normal',
    props,
    overrides: { tablet: {}, mobile: {} },
    keyframes: [],
    events: {},
    bindings: {},
  };
}

export function makeScene(id: string, name: string): SceneDocument {
  return {
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
}

export function makeBundle(name: string): SceneBundle {
  return { schemaVersion: 3, name, variables: [], presets: [], scenes: [] };
}

export const CUBE_CORNERS: readonly string[] = [
  '+x +y +z',
  '-x +y +z',
  '+x -y +z',
  '-x -y +z',
  '+x +y -z',
  '-x +y -z',
  '+x -y -z',
  '-x -y -z',
];

export const PLANE_CORNERS: readonly string[] = ['+x +y', '-x +y', '+x -y', '-x -y'];

export const PRIMITIVES: Record<
  PrimitiveKind,
  { triangles: number; halfExtents: Vec3; vertexNames: readonly string[] }
> = {
  Cube: { triangles: 12, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, vertexNames: CUBE_CORNERS },
  Sphere: { triangles: 960, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, vertexNames: CUBE_CORNERS },
  Cylinder: { triangles: 128, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, vertexNames: CUBE_CORNERS },
  Torus: { triangles: 1536, halfExtents: { x: 0.65, y: 0.65, z: 0.15 }, vertexNames: CUBE_CORNERS },
  Plane: { triangles: 2, halfExtents: { x: 0.5, y: 0.5, z: 0 }, vertexNames: PLANE_CORNERS },
};
