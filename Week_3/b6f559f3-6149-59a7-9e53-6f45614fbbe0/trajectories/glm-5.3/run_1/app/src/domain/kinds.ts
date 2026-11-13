// Scene document types and per-kind property defaults.
// The published property table is decided here, once.

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';
export const BREAKPOINTS: readonly Breakpoint[] = ['desktop', 'tablet', 'mobile'];

export type LayerKind =
  | 'Rectangle'
  | 'Ellipse'
  | 'Polygon'
  | 'Text'
  | 'Image'
  | 'Gradient'
  | 'Effect'
  | 'Primitive'
  | 'Extrusion'
  | 'Model'
  | 'Particles'
  | 'Cloth'
  | 'Group';

export const LAYER_KINDS: readonly LayerKind[] = [
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
];

export const ADD_MENU_ITEMS: readonly LayerKind[] = [
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
];

export type PrimitiveKind = 'Cube' | 'Sphere' | 'Cylinder' | 'Torus' | 'Plane';
export type EffectKind =
  | 'Blur'
  | 'Grain'
  | 'Bloom'
  | 'Glow'
  | 'Chromatic aberration'
  | 'Displacement'
  | 'Pixelate';
export type MaterialKind = 'Matcap' | 'Glass';
export type MatcapKind = 'Clay' | 'Chrome' | 'Jade' | 'Ember';
export type BlendMode = 'Normal' | 'Multiply' | 'Screen' | 'Overlay' | 'Darken' | 'Lighten';
export type GradientType = 'Linear' | 'Radial';
export type ParticleMode = 'emit' | 'form';
export type PinnedEdge = 'Top' | 'Left' | 'Corners' | 'None';
export type Environment = 'Dusk room' | 'Night grid' | 'Flat';
export type ExtrusionSource = 'text' | 'svg';
export type ModelPreset = 'Pebble' | 'Arch' | 'Lattice';
export type FacesKind = 'front' | 'both';
export type EasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'glide'
  | 'anticipate'
  | 'elastic'
  | 'bouncy';

export const EASING_DISPLAY: Record<EasingName, string> = {
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

export const EASING_ORDER: readonly EasingName[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'glide',
  'anticipate',
  'elastic',
  'bouncy',
];

export type SpringSpec = { type: 'spring'; stiffness: number; damping: number; mass: number };
export type Easing = EasingName | SpringSpec;

export interface GradientStop {
  color: string; // #RRGGBB
  position: number; // 0..100
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ClipSetting {
  name: string;
  play: boolean;
  loop: boolean;
  speed: number;
  offsetMs: number;
}

export interface Keyframe {
  property: string;
  frame: number;
  value: number | string | boolean;
  easing: Easing;
}

export interface AppearEvent {
  enabled: boolean;
  durationMs: number;
  delayMs: number;
  easing: EasingName;
  from: Record<string, number | string | boolean>;
}
export interface HoverEvent {
  enabled: boolean;
  durationMs: number;
  delayMs: number;
  easing: EasingName;
  forwardsOnly: boolean;
  to: Record<string, number | string | boolean>;
}
export interface TiltEvent {
  enabled: boolean;
  maxTilt: number;
  sensitivity: number;
  momentum: number;
}
export interface ScrollEvent {
  enabled: boolean;
  delayPct: number;
  durationPct: number;
  easing: EasingName;
  from: Record<string, number | string | boolean>;
}
export interface LoopEvent {
  enabled: boolean;
  loopDelayMs: number;
}

export interface LayerEvents {
  appear?: AppearEvent;
  hover?: HoverEvent;
  tilt?: TiltEvent;
  scroll?: ScrollEvent;
  loop?: LoopEvent;
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
  props: Record<string, unknown>;
  overrides: { tablet: Record<string, unknown>; mobile: Record<string, unknown> };
  keyframes: Keyframe[];
  events: LayerEvents;
  bindings: Record<string, string>; // property path -> variable name
}

export interface SceneCamera {
  fov: number;
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
}

export interface SceneDocument {
  id: string;
  name: string;
  background: string;
  environment: Environment;
  durationMs: number;
  camera: SceneCamera;
  orbit: { enabled: boolean; startAngle: number; endAngle: number };
  light: { enabled: boolean; sensitivity: number; momentum: number };
  layers: Layer[];
}

export interface Variable {
  name: string;
  type: 'Number' | 'Boolean' | 'Text' | 'Colour' | 'Vector 2' | 'Vector 3';
  value: number | boolean | string | Vec3 | { x: number; y: number };
}

export interface Preset {
  name: string;
  values: Record<string, Variable['value']>;
}

export interface SceneBundle {
  schemaVersion: 3;
  name: string;
  variables: Variable[];
  presets: Preset[];
  scenes: SceneDocument[];
}
