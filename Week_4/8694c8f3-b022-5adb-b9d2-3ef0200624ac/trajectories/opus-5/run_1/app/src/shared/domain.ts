/** Domain terms, value ranges and beat maths shared by the server and the browser. */

export const TICKS_PER_BEAT = 96;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;
export const TICKS_PER_QUARTER_BEAT = TICKS_PER_BEAT / 4;
export const MAX_TICK = TICKS_PER_BAR * 64;
export const LOCK_TTL_SECONDS = 30;
export const PRESENCE_TTL_SECONDS = 30;

export const LAYER_KINDS = [
  'group',
  'cube',
  'sphere',
  'plane',
  'torus',
  'tube',
  'camera',
  'light',
  'model',
  'shader',
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const OUTPUT_BUSES = ['main', 'side', 'led'] as const;
export type OutputBus = (typeof OUTPUT_BUSES)[number];
export const BUS_LABELS: Record<OutputBus, string> = {
  main: 'Main',
  side: 'Side screens',
  led: 'LED strip',
};

export const MATERIAL_KINDS: readonly LayerKind[] = ['cube', 'sphere', 'plane', 'torus', 'tube', 'model'];
export const BUS_KINDS: readonly LayerKind[] = ['cube', 'sphere', 'plane', 'torus', 'tube', 'model', 'shader'];

export const KEYABLE_PROPERTIES = [
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'props.fov',
  'props.near',
  'props.far',
  'props.twist',
  'props.radius',
  'props.intensity',
  'material.tint_alpha',
] as const;
export type KeyableProperty = (typeof KEYABLE_PROPERTIES)[number];

export function isKeyableProperty(value: string): value is KeyableProperty {
  return (KEYABLE_PROPERTIES as readonly string[]).includes(value);
}

export interface NumberRange {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

export const RANGES = {
  position: { min: -10000, max: 10000, label: 'Position' },
  rotation: { min: -10000, max: 10000, label: 'Rotation' },
  scale: { min: 0.001, max: 1000, label: 'Scale' },
  fov: { min: 10, max: 120, label: 'Field of view' },
  near: { min: 0.01, max: 10, label: 'Near plane' },
  far: { min: 0.01, max: 10000, label: 'Far plane' },
  intensity: { min: 0, max: 10, label: 'Intensity' },
  twist: { min: -10, max: 10, label: 'Twist' },
  radius: { min: 0.1, max: 100, label: 'Radius' },
  tint: { min: 0, max: 1, label: 'Tint' },
  tint_alpha: { min: 0, max: 1, label: 'Tint alpha' },
  bpm: { min: 40, max: 240, label: 'BPM' },
} as const satisfies Record<string, NumberRange>;

export type RangeName = keyof typeof RANGES;

export function rangeMessage(range: NumberRange): string {
  return `${range.label} must be between ${formatRangeBound(range.min)} and ${formatRangeBound(range.max)}`;
}

function formatRangeBound(value: number): string {
  return String(value);
}

export function clampToRange(value: number, range: NumberRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** The range that guards a keyable or settable numeric property path. */
export function rangeForPath(path: string): NumberRange | null {
  if (path.startsWith('position')) return RANGES.position;
  if (path.startsWith('rotation')) return RANGES.rotation;
  if (path.startsWith('scale')) return RANGES.scale;
  if (path === 'props.fov') return RANGES.fov;
  if (path === 'props.near') return RANGES.near;
  if (path === 'props.far') return RANGES.far;
  if (path === 'props.intensity') return RANGES.intensity;
  if (path === 'props.twist') return RANGES.twist;
  if (path === 'props.radius') return RANGES.radius;
  if (path === 'material.tint') return RANGES.tint;
  if (path === 'material.tint_alpha') return RANGES.tint_alpha;
  return null;
}

/** bar:beat text for a tick, beats written without trailing zeros. */
export function barsBeats(tick: number): string {
  const bar = Math.floor(tick / TICKS_PER_BAR) + 1;
  const beat = (tick % TICKS_PER_BAR) / TICKS_PER_BEAT + 1;
  const beatText = Number.isInteger(beat) ? String(beat) : String(Number(beat.toFixed(2)));
  return `${bar}:${beatText}`;
}

export function secondsForTick(tick: number, bpm: number): number {
  return (tick / TICKS_PER_BEAT) * (60 / bpm);
}

/** '<bar:beat> <seconds> s' for the playhead readout. */
export function playheadReadout(tick: number, bpm: number): string {
  return `${barsBeats(tick)} ${secondsForTick(tick, bpm).toFixed(3)} s`;
}

/** New keys snap to the nearest quarter beat, an exact half rounding later. */
export function snapToQuarterBeat(tick: number): number {
  const snapped = Math.floor(tick / TICKS_PER_QUARTER_BEAT + 0.5) * TICKS_PER_QUARTER_BEAT;
  return Math.min(MAX_TICK - TICKS_PER_QUARTER_BEAT, Math.max(0, snapped));
}

/** A typed BPM keeps one decimal place, an exact half rounding up. */
export function roundBpm(value: number): number {
  return Math.floor(value * 10 + 0.5) / 10;
}

export function hasAtMostOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

export const STARTER_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform float u_beat;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float pulse = 0.5 + 0.5 * sin(u_beat * 6.2831853);
  fragColor = vec4(uv * pulse, 0.5, 1.0);
}
`;

export const PRESENCE_COLOURS = ['blue', 'green', 'yellow', 'violet', 'orange', 'red'] as const;
export type PresenceColour = (typeof PRESENCE_COLOURS)[number];

export function presenceColour(joinOrder: number): PresenceColour {
  const colour = PRESENCE_COLOURS[joinOrder % PRESENCE_COLOURS.length];
  return colour ?? 'blue';
}

export const COPY = {
  storageBanner: 'Asset storage is unreachable. Uploads and publishing are paused.',
  collabBanner: 'Live collaboration is offline. Locks can\u2019t be taken right now.',
  emailInvalid: 'Enter a valid email address',
  passwordShort: 'Password must be at least 10 characters',
  displayNameInvalid: 'Display name must be 1 to 40 characters',
  emailTaken: 'An account with this email already exists',
  badCredentials: 'Email or password is incorrect',
  ownAncestor: 'A layer cannot be its own ancestor',
  wireDirection: 'Wires run from an output to an input',
  wireOccupied: 'This input already has a wire',
  wireLoop: 'This wire would make a loop',
  notAnExport: 'Not an Afterglass export',
} as const;

export const PROPERTY_LABELS: Record<string, string> = {
  name: 'Name',
  visible: 'Visible',
  position: 'Position',
  'position.x': 'Position X',
  'position.y': 'Position Y',
  'position.z': 'Position Z',
  rotation: 'Rotation',
  'rotation.x': 'Rotation X',
  'rotation.y': 'Rotation Y',
  'rotation.z': 'Rotation Z',
  scale: 'Scale',
  'scale.x': 'Scale X',
  'scale.y': 'Scale Y',
  'scale.z': 'Scale Z',
  'props.fov': 'Field of view',
  'props.near': 'Near plane',
  'props.far': 'Far plane',
  'props.twist': 'Twist',
  'props.radius': 'Radius',
  'props.intensity': 'Intensity',
  'material.tint': 'Tint',
  'material.tint_alpha': 'Tint alpha',
  'material.albedo_texture_id': 'Albedo texture',
  'material.emissive_texture_id': 'Emissive texture',
  model_asset_id: 'Model asset',
  output_buses: 'Outputs',
};

export function propertyLabel(path: string): string {
  return PROPERTY_LABELS[path] ?? path;
}

export const NODE_TYPES = ['Beat clock', 'LFO', 'Remap', 'Layer property'] as const;
export const LFO_SHAPES = ['sine', 'triangle', 'square', 'saw'] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];
