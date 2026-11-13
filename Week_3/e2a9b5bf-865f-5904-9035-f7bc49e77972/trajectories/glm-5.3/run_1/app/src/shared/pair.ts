// Measured pair values, shared by browser and server (DP-79).
import { roundHalfUp } from "./optics.js";
import { skyDistance, type SkyPoint } from "./projection.js";

export interface MeasuredPair {
  readonly primary: SkyPoint;
  readonly secondary: SkyPoint;
  readonly separation_arcmin: number;
  readonly position_angle_deg: number;
}

export function pairValues(primary: SkyPoint, secondary: SkyPoint): Pick<MeasuredPair, "separation_arcmin" | "position_angle_deg"> {
  const separation = roundHalfUp(skyDistance(primary, secondary), 1);
  const eastDiff = secondary[0] - primary[0];
  const northDiff = secondary[1] - primary[1];
  const angle = (Math.atan2(eastDiff, northDiff) * 180) / Math.PI;
  const normalised = ((angle % 360) + 360) % 360;
  const rounded = roundHalfUp(normalised, 0);
  const positionAngle = rounded >= 360 ? 0 : rounded;
  return { separation_arcmin: separation, position_angle_deg: positionAngle };
}

export function makePair(primary: SkyPoint, secondary: SkyPoint): MeasuredPair {
  return { primary, secondary, ...pairValues(primary, secondary) };
}

export function pairSentence(pair: MeasuredPair | null, marked: number): string {
  if (marked >= 2 && pair) return `Separation ${pair.separation_arcmin.toFixed(1)}′ · Position angle ${pair.position_angle_deg}°`;
  if (marked === 1) return "Mark the secondary star.";
  return "Mark the primary star.";
}
