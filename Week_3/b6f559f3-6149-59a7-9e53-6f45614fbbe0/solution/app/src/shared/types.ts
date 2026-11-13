export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export type BreakpointLevel = 'Desktop' | 'Tablet' | 'Mobile';

export const BREAKPOINT_LEVELS: Record<Breakpoint, BreakpointLevel> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};


export const ARTBOARDS: Record<Breakpoint, { width: number; height: number }> = {
  desktop: { width: 1440, height: 810 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

export const TABLET_MIN_WIDTH = 640;
export const DESKTOP_MIN_WIDTH = 1024;

export const LAYER_KINDS = [
  'Rectangle',
  'Ellipse',
  'Polygon',
  'Text',
  'Image',
  'Gradient',
  'Effect',
  'Primitive',
  'Extrusion',
  'Model',
  'Particles',
  'Cloth',
  'Group',
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const SOLID_KINDS: readonly LayerKind[] = ['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth'];

export const BLEND_MODES = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const PRIMITIVES = ['Cube', 'Sphere', 'Cylinder', 'Torus', 'Plane'] as const;
export type Primitive = (typeof PRIMITIVES)[number];

export const MODEL_PRESETS = ['Pebble', 'Arch', 'Lattice'] as const;
export type ModelPreset = (typeof MODEL_PRESETS)[number];

export const EFFECT_KINDS = ['Blur', 'Grain', 'Bloom', 'Glow', 'Chromatic aberration', 'Displacement', 'Pixelate'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EASING_NAMES = [
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
export type EasingName = (typeof EASING_NAMES)[number];

/** The display names of the easing presets, as the comboboxes list them and the inspector reports them. */
export const EASING_LABELS: Record<EasingName, string> = {
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out',
  glide: 'Glide',
  anticipate: 'Anticipate',
  elastic: 'Elastic',
  bouncy: 'Bouncy',
};

export interface SpringEasing {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
}
export type Easing = EasingName | SpringEasing;

export const ENVIRONMENTS = ['Dusk room', 'Night grid', 'Flat'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const VARIABLE_TYPES = ['Number', 'Boolean', 'Text', 'Colour', 'Vector 2', 'Vector 3'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];
export type VariableValue = number | boolean | string | Vec2 | Vec3;

export interface Variable {
  name: string;
  type: VariableType;
  value: VariableValue;
}

export interface Preset {
  name: string;
  values: Record<string, VariableValue>;
}

export interface Keyframe {
  property: string;
  frame: number;
  value: number;
  easing: Easing;
}

export type OverrideMap = Record<string, Json>;

export interface BreakpointOverrides {
  tablet: OverrideMap;
  mobile: OverrideMap;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  parentId: string | null;
  order: number;
  visible: boolean;
  locked: boolean;
  maskAbove: boolean;
  blendMode: BlendMode;
  props: JsonObject;
  overrides: BreakpointOverrides;
  keyframes: Keyframe[];
  events: JsonObject;
  bindings: Record<string, string>;
}

export interface SceneCamera {
  fov: number;
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
}

export interface SceneOrbit {
  enabled: boolean;
  startAngle: number;
  endAngle: number;
}

export interface SceneLight {
  enabled: boolean;
  sensitivity: number;
  momentum: number;
}

export interface SceneFields {
  id: string;
  name: string;
  background: string;
  environment: Environment;
  durationMs: number;
  camera: SceneCamera;
  orbit: SceneOrbit;
  light: SceneLight;
  overrides: BreakpointOverrides;
}

export interface Scene extends SceneFields {
  layers: Layer[];
}

/** The scene document schema this app reads and writes. */
export const SCHEMA_VERSION = 3;

export interface SceneDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  variables: Variable[];
  presets: Preset[];
  scenes: Scene[];
}

export interface Seeds {
  particle: number;
  cloth: number;
  grain: number;
}

export type Change =
  | { type: 'addLayer'; layer: Partial<Layer> & { kind: LayerKind }; ref: string }
  | { type: 'updateLayer'; layerId: string; set: JsonObject; breakpoint: Breakpoint }
  | { type: 'clearOverride'; layerId: string; breakpoint: Breakpoint; path: string }
  | { type: 'deleteLayer'; layerId: string }
  | { type: 'moveLayer'; layerId: string; parentId: string | null; order: number }
  | { type: 'duplicateLayer'; layerId: string }
  | { type: 'group'; layerIds: string[] }
  | { type: 'ungroup'; groupId: string }
  | { type: 'setKeyframe'; layerId: string; property: string; frame: number; value: number; easing: Easing }
  | { type: 'moveKeyframe'; layerId: string; property: string; fromFrame: number; toFrame: number }
  | { type: 'deleteKeyframe'; layerId: string; property: string; frame: number }
  | { type: 'updateScene'; set: JsonObject; breakpoint: Breakpoint }
  | { type: 'addVariable'; variable: Variable }
  | { type: 'updateVariable'; name: string; value: VariableValue }
  | { type: 'deleteVariable'; name: string }
  | { type: 'bind'; layerId: string; property: string; variable: string }
  | { type: 'unbind'; layerId: string; property: string }
  | { type: 'savePreset'; name: string }
  | { type: 'applyPreset'; name: string }
  | { type: 'deletePreset'; name: string };

export type Role = 'Owner' | 'Editor' | 'Viewer';

export interface ModelNode {
  name: string;
  parent: number | null;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  mesh: number | null;
}

export interface ModelChannel {
  node: string;
  path: 'translation' | 'rotation' | 'scale';
  interpolation: 'LINEAR' | 'STEP';
  times: number[];
  values: number[];
}

export interface ModelClip {
  name: string;
  durationS: number;
  channels: ModelChannel[];
}

export interface ModelBounds {
  min: Vec3;
  max: Vec3;
}

export interface ModelSummary {
  nodes: ModelNode[];
  clips: ModelClip[];
  bounds: ModelBounds;
  vertices: number;
  triangles: number;
}

export type OutlinePoint = [number, number];

export interface AssetInfo {
  id: string;
  kind: 'image' | 'svg' | 'model';
  fileName: string;
  bytes: number;
  sha256: string;
  status: 'pending' | 'confirmed' | 'failed';
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: { name: string; durationS: number }[];
  model: ModelSummary | null;
  outline: OutlinePoint[] | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  status: 'active' | 'trashed';
  role: Role;
  layerCount: number;
  liveVersion: number | null;
  editorCount: number;
  viewerCount: number;
  trashedAt: string | null;
  purgeAt: string | null;
}

export interface LockInfo {
  layerId: string;
  heldBy: { id: string; name: string };
  expiresAt: string;
}

export interface VersionInfo {
  number: number;
  status: 'live' | 'superseded';
  publishedAt: string;
  publishedBy: string;
  sha256: string;
  notice: 'sent' | 'queued';
}

export interface MemberInfo {
  personId: string;
  name: string;
  email: string;
  role: Role;
}

export interface InviteInfo {
  id: string;
  email: string;
  role: 'Editor' | 'Viewer';
  status: 'sent' | 'queued' | 'accepted' | 'expired';
  expiresAt: string;
}

export interface PublicSettings {
  autosaveMs: number;
  embedPollSeconds: number;
  particleMax: number;
  timeZone: string;
}
