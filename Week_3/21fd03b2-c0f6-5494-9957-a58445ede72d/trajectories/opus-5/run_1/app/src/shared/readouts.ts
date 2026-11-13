import { dcos, dsin, dsqrt, radians, roundTo } from './dmath.js';
import type { ObjectKind } from './params.js';

export interface Readout {
  readonly label: string;
  /** null reads as `n/a`. */
  readonly value: number | null;
  readonly unit: string;
}

export type ParamValues = Readonly<Record<string, number | null>>;

function get(params: ParamValues, key: string): number | null {
  const value = params[key];
  return value === undefined ? null : value;
}

/** The derived readouts for one object, from the values in effect on screen. */
export function derivedReadouts(
  kind: ObjectKind,
  params: ParamValues,
  gravity: number | null,
): Readout[] {
  if (kind === 'ramp') return rampReadouts(params, gravity);
  if (kind === 'pendulum') return pendulumReadouts(params, gravity);
  if (kind === 'launcher') return launcherReadouts(params, gravity);
  return [];
}

function rampReadouts(params: ParamValues, gravity: number | null): Readout[] {
  const mass = get(params, 'mass_kg');
  const angle = get(params, 'angle_deg');
  const length = get(params, 'length_m');
  const friction = get(params, 'friction');
  const ready = gravity !== null && angle !== null && length !== null && friction !== null;
  const height = ready ? length * dsin(radians(angle)) : null;
  const acceleration = ready
    ? gravity * (dsin(radians(angle)) - friction * dcos(radians(angle)))
    : null;
  return [
    {
      label: 'Potential energy',
      value: mass !== null && height !== null && gravity !== null ? mass * gravity * height : null,
      unit: 'J',
    },
    {
      label: 'Speed at bottom',
      value:
        acceleration === null || length === null
          ? null
          : acceleration > 0
            ? dsqrt(2 * acceleration * length)
            : 0,
      unit: 'm/s',
    },
    {
      label: 'Time to bottom',
      value:
        acceleration === null || length === null || acceleration <= 0
          ? null
          : dsqrt((2 * length) / acceleration),
      unit: 's',
    },
  ];
}

function pendulumReadouts(params: ParamValues, gravity: number | null): Readout[] {
  const length = get(params, 'length_m');
  const release = get(params, 'release_deg');
  return [
    {
      label: 'Period',
      value: length !== null && gravity !== null ? 2 * Math.PI * dsqrt(length / gravity) : null,
      unit: 's',
    },
    {
      label: 'Speed at bottom',
      value:
        length !== null && release !== null && gravity !== null
          ? dsqrt(2 * gravity * length * (1 - dcos(radians(release))))
          : null,
      unit: 'm/s',
    },
  ];
}

function launcherReadouts(params: ParamValues, gravity: number | null): Readout[] {
  const speed = get(params, 'speed_mps');
  const angle = get(params, 'launch_angle_deg');
  const height = get(params, 'height_m');
  const ready = speed !== null && angle !== null && height !== null && gravity !== null;
  const vy = ready ? speed * dsin(radians(angle)) : null;
  const vx = ready ? speed * dcos(radians(angle)) : null;
  const flight =
    ready && vy !== null && gravity !== null && height !== null
      ? (vy + dsqrt(vy * vy + 2 * gravity * height)) / gravity
      : null;
  return [
    { label: 'Time of flight', value: flight, unit: 's' },
    { label: 'Range', value: vx !== null && flight !== null ? vx * flight : null, unit: 'm' },
    {
      label: 'Peak height',
      value:
        height !== null && vy !== null && gravity !== null
          ? height + (vy * vy) / (2 * gravity)
          : null,
      unit: 'm',
    },
  ];
}

export function readoutText(readout: Readout): string {
  if (readout.value === null || !Number.isFinite(readout.value))
    return `${readout.label}: n/a`;
  return `${readout.label}: ${formatReadoutValue(readout.value)} ${readout.unit}`;
}

export function formatReadoutValue(value: number): string {
  return roundTo(value, 2).toFixed(2);
}
