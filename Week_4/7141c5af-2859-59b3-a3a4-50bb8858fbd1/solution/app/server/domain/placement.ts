import { fixed, type Rational, rational, over, times, whole } from "./decimal.ts";
import { copy } from "./copy.ts";

export type PartName = "Seat" | "Back" | "Left side" | "Right side" | "Headrest";

export interface Placement {
  name: PartName;
  x: number;
  y: number;
  rotation: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const HIDE_WIDTH_CM = 200;
export const HIDE_HEIGHT_CM = 240;
export const HIDE_AREA_SQ_FT = "51.67";
const SQ_CM_PER_SQ_FT = rational("929.0304");

export const PARTS: Record<PartName, { width: number; height: number; rotations: readonly number[] }> = {
  Seat: { width: 62, height: 58, rotations: [0, 180] },
  Back: { width: 62, height: 74, rotations: [0, 180] },
  "Left side": { width: 30, height: 74, rotations: [0, 180] },
  "Right side": { width: 30, height: 74, rotations: [0, 180] },
  Headrest: { width: 40, height: 22, rotations: [0, 90, 180, 270] },
};

export const PART_NAMES = Object.keys(PARTS) as PartName[];

export const FLAWS: readonly Box[] = [
  { x: 120, y: 80, width: 30, height: 20 },
  { x: 20, y: 200, width: 16, height: 12 },
];

export function isPartName(name: string): name is PartName {
  return Object.hasOwn(PARTS, name);
}

/** A piece's box on the hide: at 90 or 270 its sides swap, and rotating keeps the top-left. */
export function partBox(placement: Placement): Box {
  const { width, height } = PARTS[placement.name];
  const turned = placement.rotation === 90 || placement.rotation === 270;
  return { x: placement.x, y: placement.y, width: turned ? height : width, height: turned ? width : height };
}

function crosses(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The refusal for a rotation: F-50 for a grain-bound piece turned across the grain, F-08 for anything else unpublished. */
export function rotationRefusal(name: PartName, rotation: number): string | null {
  if (PARTS[name].rotations.includes(rotation)) return null;
  return rotation === 90 || rotation === 270 ? copy("F-50", { part: name }) : copy("F-08");
}

/** The one placement decision: off the hide, then flaw, then overlap, each in published order. */
export function placementRefusal(placement: Placement, others: readonly Placement[]): string | null {
  if (!Number.isInteger(placement.x) && placement.x >= 0) return copy("F-08");
  if (!Number.isInteger(placement.y) && placement.y >= 0) return copy("F-08");
  const box = partBox(placement);
  const offHide = box.x < 0 || box.y < 0 || box.x + box.width > HIDE_WIDTH_CM || box.y + box.height > HIDE_HEIGHT_CM;
  if (offHide) return copy("F-47", { part: placement.name });
  for (const flaw of FLAWS) {
    if (crosses(box, flaw)) return copy("F-48", { part: placement.name, x: flaw.x, y: flaw.y });
  }
  const placedFirst = PART_NAMES.flatMap((name) => others.filter((other) => other.name === name));
  for (const other of placedFirst) {
    if (other.name !== placement.name && crosses(box, partBox(other))) {
      return copy("F-49", { part: placement.name, "other part": other.name });
    }
  }
  return null;
}

function squareFeet(squareCm: number): Rational {
  return over(whole(squareCm), SQ_CM_PER_SQ_FT);
}

function partArea(name: PartName): number {
  return PARTS[name].width * PARTS[name].height;
}

/** The used-leather figure, half up on the exact value. */
export function usedFigure(placed: readonly Placement[]): { usedSqFt: string; usedPercent: string } {
  const area = placed.reduce((sum, placement) => sum + partArea(placement.name), 0);
  return {
    usedSqFt: fixed(squareFeet(area), 2),
    usedPercent: fixed(times(whole(area * 100), over(whole(1), whole(HIDE_WIDTH_CM * HIDE_HEIGHT_CM))), 1),
  };
}

/** The pattern area an estimate starts from: the hide's five pieces, half up to two decimals. */
export function defaultPatternArea(): string {
  return fixed(squareFeet(PART_NAMES.reduce((sum, name) => sum + partArea(name), 0)), 2);
}
