// Chainage on the page: spans, ribbon steps, nearby findings, nearest towers, centreline points
// and the fallback ground (interpolated tower base heights) when no terrain is loaded.
import { spanAt, type TowerMark } from "../../shared/corridorLine";
import { inverse, type Centreline } from "../../shared/geodesy";
import type { Coverage, Tower } from "./api";

const NEAR_REACH_M = 25;
const STEP_M = 10;
const SHIFT_STEP_M = 100;

export interface CorridorShape {
  lengthM: number;
  towers: Tower[];
  marks: TowerMark[];
  line: Centreline;
}

/** The corridor geometry the page needs: the centreline is the geodesic from tower 1 through tower 2. */
export function shapeOf(towers: Tower[], lengthM: number): CorridorShape {
  const first = towers[0];
  const second = towers[1];
  const origin = { lonDeg: first?.lon_deg ?? 0, latDeg: first?.lat_deg ?? 0 };
  const azimuthDeg = second === undefined ? 0 : inverse(origin, { lonDeg: second.lon_deg, latDeg: second.lat_deg }).azimuthDeg;
  const marks = towers.map((t) => ({ number: t.number, chainageM: t.chainage_m, baseHeightM: t.base_height_m }));
  return { lengthM, towers, marks, line: { origin, azimuthDeg } };
}

export function spanOf(shape: CorridorShape, chainageM: number): { from: number; to: number } {
  const span = spanAt(shape.marks, chainageM);
  return { from: span.fromTower, to: span.toTower };
}

export function clampChainage(shape: CorridorShape, chainageM: number): number {
  return Math.min(shape.lengthM, Math.max(0, Math.round(chainageM * 10) / 10));
}

type StepKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown" | "Home" | "End";

export function isStepKey(key: string): key is StepKey {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(key);
}

/** The slider's published keys: 10 m (100 m with Shift), towers strictly before/after, ends; clamped. */
export function steppedChainage(shape: CorridorShape, chainageM: number, key: StepKey, shift: boolean): number {
  const step = shift ? SHIFT_STEP_M : STEP_M;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampChainage(shape, chainageM - step);
    case "ArrowRight":
    case "ArrowUp":
      return clampChainage(shape, chainageM + step);
    case "PageUp": {
      const before = shape.towers.filter((t) => t.chainage_m < chainageM).pop();
      return before?.chainage_m ?? chainageM;
    }
    case "PageDown": {
      const after = shape.towers.find((t) => t.chainage_m > chainageM);
      return after?.chainage_m ?? chainageM;
    }
    case "Home":
      return 0;
    case "End":
      return shape.lengthM;
  }
}

export function isNear(findingChainageM: number, playheadM: number): boolean {
  return Math.abs(findingChainageM - playheadM) <= NEAR_REACH_M + 1e-9;
}

/** The tower closest to a chainage; a tie goes to the lower-numbered tower. */
export function nearestTower(shape: CorridorShape, chainageM: number): Tower | undefined {
  let best: Tower | undefined;
  for (const tower of shape.towers) {
    if (best === undefined || Math.abs(tower.chainage_m - chainageM) < Math.abs(best.chainage_m - chainageM)) best = tower;
  }
  return best;
}

/** The uncovered stretches between 0 and the corridor length. */
export function uncoveredRanges(shape: CorridorShape, coverage: Coverage[]): Coverage[] {
  const gaps: Coverage[] = [];
  let cursor = 0;
  for (const range of coverage) {
    if (range.from_m > cursor) gaps.push({ from_m: cursor, to_m: range.from_m });
    cursor = Math.max(cursor, range.to_m);
  }
  if (cursor < shape.lengthM) gaps.push({ from_m: cursor, to_m: shape.lengthM });
  return gaps;
}
