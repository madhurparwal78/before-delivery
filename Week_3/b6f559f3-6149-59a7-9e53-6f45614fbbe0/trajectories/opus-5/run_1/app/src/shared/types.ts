export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export type OverrideLevel = 'tablet' | 'mobile';

export const LEVEL_NAMES: Record<Breakpoint, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

export const ARTBOARDS: Record<Breakpoint, { width: number; height: number }> = {
  desktop: { width: 1440, height: 810 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

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

export interface SpringEasing {
  [key: string]: JsonValue;
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
}

export type Easing = EasingName | SpringEasing;

export interface Keyframe {
  property: string;
  frame: number;
  value: JsonValue;
  easing: Easing;
}

export interface LayerEvents {
  appear: {
    enabled: boolean;
    durationMs: number;
    delayMs: number;
    easing: EasingName;
    from: Record<string, JsonValue>;
  };
  hover: {
    enabled: boolean;
    durationMs: number;
    delayMs: number;
    easing: EasingName;
    forwardsOnly: boolean;
    to: Record<string, JsonValue>;
  };
  tilt: { enabled: boolean; maxTilt: number; sensitivity: number; momentum: number };
  scroll: {
    enabled: boolean;
    delayPct: number;
    durationPct: number;
    easing: EasingName;
    from: Record<string, JsonValue>;
  };
  loop: { enabled: boolean; loopDelayMs: number };
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
  blendMode: string;
  props: JsonObject;
  overrides: { tablet: Record<string, JsonValue>; mobile: Record<string, JsonValue> };
  keyframes: Keyframe[];
  events: LayerEvents;
  bindings: Record<string, string>;
}

export interface SceneCamera {
  fov: number;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  near: number;
  far: number;
}

export interface Scene {
  id: string;
  name: string;
  background: string;
  environment: string;
  durationMs: number;
  camera: SceneCamera;
  orbit: { enabled: boolean; startAngle: number; endAngle: number };
  light: { enabled: boolean; sensitivity: number; momentum: number };
  layers: Layer[];
}

export type VariableType = 'Number' | 'Boolean' | 'Text' | 'Colour' | 'Vector 2' | 'Vector 3';

export interface Variable {
  name: string;
  type: VariableType;
  value: JsonValue;
}

export interface Preset {
  name: string;
  values: Record<string, JsonValue>;
}

export interface SceneDocument {
  schemaVersion: number;
  name: string;
  variables: Variable[];
  presets: Preset[];
  scenes: Scene[];
}

export interface AssetClip {
  name: string;
  durationS: number;
}

export interface AssetRecord {
  id: string;
  kind: 'image' | 'svg' | 'model';
  fileName: string;
  bytes: number;
  sha256: string;
  status: 'pending' | 'confirmed' | 'failed';
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: AssetClip[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
