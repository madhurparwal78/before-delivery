import type { SceneObject } from './scene';

export type ReadoutRow = { label: string; value: number | null; unit: string };

export type ReadoutInputs = {
  gravity: number;
  mass_kg: number | null;
  angle_deg: number | null;
  length_m: number | null;
  friction: number | null;
  release_deg: number | null;
  speed_mps: number | null;
  launch_angle_deg: number | null;
  height_m: number | null;
};

export const EMPTY_INPUTS: ReadoutInputs = {
  gravity: 9.81,
  mass_kg: null,
  angle_deg: null,
  length_m: null,
  friction: null,
  release_deg: null,
  speed_mps: null,
  launch_angle_deg: null,
  height_m: null,
};

export function rampReadouts(inputs: ReadoutInputs): ReadoutRow[] {
  const { gravity, mass_kg, angle_deg, length_m, friction } = inputs;
  if (mass_kg === null || angle_deg === null || length_m === null || friction === null) {
    return [
      { label: 'Potential energy', value: null, unit: 'J' },
      { label: 'Speed at bottom', value: null, unit: 'm/s' },
      { label: 'Time to bottom', value: null, unit: 's' },
    ];
  }
  const angle = (angle_deg * Math.PI) / 180;
  const h = length_m * Math.sin(angle);
  const a = gravity * (Math.sin(angle) - friction * Math.cos(angle));
  const potentialEnergy = mass_kg * gravity * h;
  const speedAtBottom = a > 0 ? Math.sqrt(2 * a * length_m) : 0;
  const timeToBottom = a > 0 ? Math.sqrt((2 * length_m) / a) : null;
  return [
    { label: 'Potential energy', value: potentialEnergy, unit: 'J' },
    { label: 'Speed at bottom', value: speedAtBottom, unit: 'm/s' },
    { label: 'Time to bottom', value: timeToBottom, unit: 's' },
  ];
}

function pendulumReadouts(inputs: ReadoutInputs): ReadoutRow[] {
  const { gravity, length_m, release_deg } = inputs;
  if (length_m === null || release_deg === null) {
    return [
      { label: 'Period', value: null, unit: 's' },
      { label: 'Speed at bottom', value: null, unit: 'm/s' },
    ];
  }
  const period = 2 * Math.PI * Math.sqrt(length_m / gravity);
  const release = (release_deg * Math.PI) / 180;
  const speed = Math.sqrt(2 * gravity * length_m * (1 - Math.cos(release)));
  return [
    { label: 'Period', value: period, unit: 's' },
    { label: 'Speed at bottom', value: speed, unit: 'm/s' },
  ];
}

function launcherReadouts(inputs: ReadoutInputs): ReadoutRow[] {
  const { gravity, speed_mps, launch_angle_deg, height_m } = inputs;
  if (speed_mps === null || launch_angle_deg === null || height_m === null) {
    return [
      { label: 'Time of flight', value: null, unit: 's' },
      { label: 'Range', value: null, unit: 'm' },
      { label: 'Peak height', value: null, unit: 'm' },
    ];
  }
  const angle = (launch_angle_deg * Math.PI) / 180;
  const vy = speed_mps * Math.sin(angle);
  const vx = speed_mps * Math.cos(angle);
  const timeOfFlight = (vy + Math.sqrt(vy * vy + 2 * gravity * height_m)) / gravity;
  const range = vx * timeOfFlight;
  const peakHeight = height_m + (vy * vy) / (2 * gravity);
  return [
    { label: 'Time of flight', value: timeOfFlight, unit: 's' },
    { label: 'Range', value: range, unit: 'm' },
    { label: 'Peak height', value: peakHeight, unit: 'm' },
  ];
}

export function readoutsForObject(object: SceneObject | null, gravity: number, overrides: Partial<ReadoutInputs> = {}): ReadoutRow[] {
  if (!object) return [];
  if (object.kind === 'ramp') return rampReadouts({ ...EMPTY_INPUTS, ...objectParams(object), gravity, ...overrides });
  if (object.kind === 'pendulum') return pendulumReadouts({ ...EMPTY_INPUTS, ...objectParams(object), gravity, ...overrides });
  if (object.kind === 'launcher') return launcherReadouts({ ...EMPTY_INPUTS, ...objectParams(object), gravity, ...overrides });
  return [];
}

export function objectParams(object: SceneObject): Partial<ReadoutInputs> {
  const p = object.params as Record<string, number>;
  const out: Partial<ReadoutInputs> = {};
  if (typeof p.mass_kg === 'number') out.mass_kg = p.mass_kg;
  if (typeof p.angle_deg === 'number') out.angle_deg = p.angle_deg;
  if (typeof p.length_m === 'number') out.length_m = p.length_m;
  if (typeof p.friction === 'number') out.friction = p.friction;
  if (typeof p.release_deg === 'number') out.release_deg = p.release_deg;
  if (typeof p.speed_mps === 'number') out.speed_mps = p.speed_mps;
  if (typeof p.launch_angle_deg === 'number') out.launch_angle_deg = p.launch_angle_deg;
  if (typeof p.height_m === 'number') out.height_m = p.height_m;
  return out;
}

export function formatReadout(row: ReadoutRow): string {
  if (row.value === null) return `${row.label}: n/a`;
  return `${row.label}: ${roundHalfAway(row.value, 2)} ${row.unit}`;
}

export function roundHalfAway(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return (rounded / factor).toFixed(decimals);
}
