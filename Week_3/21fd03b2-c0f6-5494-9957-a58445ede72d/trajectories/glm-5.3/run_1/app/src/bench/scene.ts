
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type ObjectKind = 'ramp' | 'pendulum' | 'launcher' | 'crate' | 'model';

export type RampParams = {
  mass_kg: number;
  angle_deg: number;
  length_m: number;
  friction: number;
};
export type PendulumParams = { mass_kg: number; length_m: number; release_deg: number };
export type LauncherParams = { mass_kg: number; speed_mps: number; launch_angle_deg: number; height_m: number };
export type CrateParams = { mass_kg: number };

export type ObjectParams = RampParams | PendulumParams | LauncherParams | CrateParams | Record<string, never>;

export type SceneObject = {
  id: string;
  kind: ObjectKind;
  name: string;
  params: Record<string, number>;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  assetId: string | null;
};

export type SceneDocument = {
  gravity: number;
  name: string;
  objects: SceneObject[];
  solver: { iterations: 4; step: '1/120' };
};

export type ParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  group: 'mass' | 'length' | 'angle' | 'none';
};

export type KindSpec = { kind: ObjectKind; params: ParamSpec[] };

export const RAMP_PARAMS: ParamSpec[] = [
  { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, step: 0.1, default: 1, group: 'mass' },
  { key: 'angle_deg', label: 'Angle (degrees)', min: 1, max: 60, step: 1, default: 30, group: 'angle' },
  { key: 'length_m', label: 'Length (m)', min: 0.5, max: 20, step: 0.1, default: 3, group: 'length' },
  { key: 'friction', label: 'Friction', min: 0, max: 1, step: 0.01, default: 0, group: 'none' },
];

export const PENDULUM_PARAMS: ParamSpec[] = [
  { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, step: 0.1, default: 0.5, group: 'mass' },
  { key: 'length_m', label: 'Length (m)', min: 0.1, max: 10, step: 0.1, default: 1, group: 'length' },
  { key: 'release_deg', label: 'Release angle (degrees)', min: 1, max: 80, step: 1, default: 20, group: 'angle' },
];

export const LAUNCHER_PARAMS: ParamSpec[] = [
  { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, step: 0.1, default: 0.2, group: 'mass' },
  { key: 'speed_mps', label: 'Launch speed (m/s)', min: 0.1, max: 50, step: 0.1, default: 5, group: 'none' },
  { key: 'launch_angle_deg', label: 'Launch angle (degrees)', min: 0, max: 89, step: 1, default: 45, group: 'angle' },
  { key: 'height_m', label: 'Launch height (m)', min: 0, max: 20, step: 0.1, default: 1, group: 'length' },
];

export const CRATE_PARAMS: ParamSpec[] = [
  { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, step: 0.1, default: 1, group: 'mass' },
];

export const GRAVITY_SPEC: ParamSpec = {
  key: 'gravity',
  label: 'Gravity (m/s²)',
  min: 0.1,
  max: 30,
  step: 0.01,
  default: 9.81,
  group: 'none',
};

export const KIND_SPECS: Record<ObjectKind, KindSpec> = {
  ramp: { kind: 'ramp', params: RAMP_PARAMS },
  pendulum: { kind: 'pendulum', params: PENDULUM_PARAMS },
  launcher: { kind: 'launcher', params: LAUNCHER_PARAMS },
  crate: { kind: 'crate', params: CRATE_PARAMS },
  model: { kind: 'model', params: [] },
};

export const KIND_LABELS: Record<ObjectKind, string> = {
  ramp: 'ramp',
  pendulum: 'pendulum',
  launcher: 'launcher',
  crate: 'crate',
  model: 'model',
};

export function objectParams(kind: ObjectKind): Record<string, number> {
  const spec = KIND_SPECS[kind];
  const out: Record<string, number> = {};
  for (const p of spec.params) out[p.key] = p.default;
  return out;
}

export const POSITION_FIELD_SPECS: ParamSpec[] = [
  { key: 'positionX', label: 'Position X (m)', min: -500, max: 500, step: 0.1, default: 0, group: 'length' },
  { key: 'positionY', label: 'Position Y (m)', min: -500, max: 500, step: 0.1, default: 0, group: 'length' },
  { key: 'positionZ', label: 'Position Z (m)', min: -500, max: 500, step: 0.1, default: 0, group: 'length' },
];

export const TEMPLATES = ['blank', 'ramp', 'pendulum', 'launcher'] as const;
export type Template = (typeof TEMPLATES)[number];

export function templateDocument(template: Template, name: string): SceneDocument {
  const doc: SceneDocument = { gravity: 9.81, name, objects: [], solver: { iterations: 4, step: '1/120' } };
  if (template === 'ramp') doc.objects.push(namedObject('ramp', 'ramp-1', 'Ramp 1'));
  if (template === 'pendulum') doc.objects.push(namedObject('pendulum', 'pendulum-1', 'Pendulum 1'));
  if (template === 'launcher') doc.objects.push(namedObject('launcher', 'launcher-1', 'Launcher 1'));
  return doc;
}

export function namedObject(kind: ObjectKind, id: string, name: string, assetId: string | null = null): SceneObject {
  return {
    id,
    kind,
    name,
    params: objectParams(kind),
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    assetId,
  };
}

// New-object ids are minted by the caller: the server uses crypto randomness
// and the browser uses Math.random, both producing kind-prefixed unique ids.
export function objectIdFor(kind: ObjectKind, randomSuffix: string): string {
  return `${KIND_LABELS[kind]}-${randomSuffix}`;
}

export function makeSerialName(kind: ObjectKind, existing: string[], prefix: string): string {
  let n = 1;
  const lower = existing.map((s) => s.toLowerCase());
  while (lower.includes(`${prefix} ${n}`.toLowerCase())) n++;
  return `${prefix} ${n}`;
}
