import { COPY } from "./messages";
import { halfUp } from "./optics";
import type { Pair, Point } from "./types";

function separationArcmin(primary: Point, secondary: Point): number {
  return halfUp(Math.hypot(secondary[0] - primary[0], secondary[1] - primary[1]), 1);
}

function positionAngleDeg(primary: Point, secondary: Point): number {
  const degrees = (Math.atan2(secondary[0] - primary[0], secondary[1] - primary[1]) * 180) / Math.PI;
  const normal = ((degrees % 360) + 360) % 360;
  return halfUp(normal) % 360;
}

export function measuredPair(primary: Point, secondary: Point): Required<Pair> {
  return {
    primary,
    secondary,
    separation_arcmin: separationArcmin(primary, secondary),
    position_angle_deg: positionAngleDeg(primary, secondary),
  };
}

export function pairSentence(pair: Pair | null, marks: number): string {
  if (marks === 0) return COPY.pairPrimary;
  if (!pair || marks === 1) return COPY.pairSecondary;
  const m = measuredPair(pair.primary, pair.secondary);
  return `Separation ${m.separation_arcmin.toFixed(1)}′ · Position angle ${m.position_angle_deg}°`;
}
