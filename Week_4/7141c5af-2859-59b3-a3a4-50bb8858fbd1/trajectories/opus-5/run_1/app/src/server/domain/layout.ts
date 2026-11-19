/**
 * The hide and its pattern pieces. Every placement decision is made here and
 * nowhere else.
 */
import { divHalfUp, fromInt, toFixed } from './decimal.ts';
import { sqCmToSqFt } from './money.ts';
import {
  HIDE_HEIGHT_CM,
  HIDE_WIDTH_CM,
  PATTERN,
  PIECE_NAMES,
  allowedRotations,
  boxOf,
  type PieceName,
} from '../../shared/pattern.ts';

export {
  HIDE_WIDTH_CM,
  HIDE_HEIGHT_CM,
  PIECE_NAMES,
  PATTERN,
  isPieceName,
  boxOf,
  allowedRotations,
} from '../../shared/pattern.ts';
export type { PieceName } from '../../shared/pattern.ts';

export const HIDE_AREA_SQ_CM = HIDE_WIDTH_CM * HIDE_HEIGHT_CM;

export interface Flaw {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Every piece has this same hide. */
export const FLAWS: readonly Flaw[] = [
  { x: 120, y: 80, width: 30, height: 20 },
  { x: 20, y: 200, width: 16, height: 12 },
];

export type PlacementState = 'tray' | 'placed';

export interface Placement {
  name: PieceName;
  x: number | null;
  y: number | null;
  rotation: number;
  state: PlacementState;
}

export type RotationRefusal = 'grainBound' | 'outOfRange';

/** A rotation is checked before the placement. */
export function checkRotation(name: PieceName, rotation: number): RotationRefusal | null {
  if (allowedRotations(name).includes(rotation)) return null;
  if (PATTERN[name].withGrain && (rotation === 90 || rotation === 270)) return 'grainBound';
  return 'outOfRange';
}

export type PlacementRefusal =
  | { kind: 'coordinate' }
  | { kind: 'offHide' }
  | { kind: 'flaw'; flaw: Flaw }
  | { kind: 'overlap'; other: PieceName };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Boxes that only touch along an edge neither cross nor overlap. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Decides a placement in the published order: off the hide, then flaw, then
 * overlap, flaws and pieces each in their own published order.
 */
export function checkPlacement(
  name: PieceName,
  x: number,
  y: number,
  rotation: number,
  others: readonly Placement[],
): PlacementRefusal | null {
  if (x < 0 || y < 0) return { kind: 'offHide' };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { kind: 'coordinate' };

  const box = { x, y, ...boxOf(name, rotation) };
  if (box.x + box.width > HIDE_WIDTH_CM || box.y + box.height > HIDE_HEIGHT_CM) {
    return { kind: 'offHide' };
  }
  for (const flaw of FLAWS) {
    if (overlaps(box, flaw)) return { kind: 'flaw', flaw };
  }
  for (const other of PIECE_NAMES) {
    if (other === name) continue;
    const p = others.find((q) => q.name === other);
    if (!p || p.state !== 'placed' || p.x === null || p.y === null) continue;
    const otherBox = { x: p.x, y: p.y, ...boxOf(other, p.rotation) };
    if (overlaps(box, otherBox)) return { kind: 'overlap', other };
  }
  return null;
}

export interface HideFigure {
  usedSqFt: string;
  usedPercent: string;
}

/** The placed pieces' area, half up on the exact value. */
export function hideFigure(placements: readonly Placement[]): HideFigure {
  let sqCm = 0;
  for (const p of placements) {
    if (p.state !== 'placed') continue;
    const box = boxOf(p.name, p.rotation);
    sqCm += box.width * box.height;
  }
  return {
    usedSqFt: toFixed(sqCmToSqFt(sqCm), 2),
    usedPercent: toFixed(divHalfUp(fromInt(sqCm * 100), fromInt(HIDE_AREA_SQ_CM), 1), 1),
  };
}

export const HIDE_AREA_SQ_FT = toFixed(sqCmToSqFt(HIDE_AREA_SQ_CM), 2);

/** The pattern area the estimate starts from: all five pieces. */
export const PATTERN_AREA_SQ_FT = toFixed(
  sqCmToSqFt(PIECE_NAMES.reduce((sum, n) => sum + PATTERN[n].width * PATTERN[n].height, 0)),
  2,
);

export function emptyPlacements(): Placement[] {
  return PIECE_NAMES.map((name) => ({ name, x: null, y: null, rotation: 0, state: 'tray' as const }));
}

/** The seed's starting layout: Seat placed at the origin, the rest in the tray. */
export function seededPlacements(): Placement[] {
  return emptyPlacements().map((p) =>
    p.name === 'Seat' ? { ...p, x: 0, y: 0, state: 'placed' as const } : p,
  );
}
