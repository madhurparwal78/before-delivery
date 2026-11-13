import { roundHalfUp } from './round.js';
import type { MeasuredPair, PairInput, SkyPoint } from './types.js';

function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

export function isSkyPoint(value: unknown): value is SkyPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && hasAtMostTwoDecimals(n))
  );
}

export function samePoint(a: SkyPoint, b: SkyPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Separation in arcminutes and position angle in degrees, from primary to secondary. */
export function derivePair(input: PairInput): MeasuredPair {
  const east = input.secondary[0] - input.primary[0];
  const north = input.secondary[1] - input.primary[1];
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  const normalised = ((degrees % 360) + 360) % 360;
  const angle = roundHalfUp(normalised);
  return {
    primary: input.primary,
    secondary: input.secondary,
    separation_arcmin: roundHalfUp(Math.hypot(east, north), 1),
    position_angle_deg: angle === 360 ? 0 : angle,
  };
}

export function formatSeparation(separationArcmin: number): string {
  return separationArcmin.toFixed(1);
}
