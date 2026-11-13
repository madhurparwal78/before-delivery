import { halfUnitsToInches } from './measure';

const LAYER_CLEARANCE_HALF_UNITS = 2; // 1.0 in above the tallest piece

export interface PlacedPiece {
  pieceNumber: string;
  layer: number;
  /** Rounded height in half-inch units. */
  height: number;
  /** Cubic inches in thousandths. */
  cubicMilli: number;
}

/** Layer height is the tallest placed piece plus an inch of clearance. */
export function layerHeightIn(placed: PlacedPiece[]): string | null {
  const tallest = placed.reduce((max, piece) => Math.max(max, piece.height), 0);
  if (placed.length === 0) return null;
  return halfUnitsToInches(tallest + LAYER_CLEARANCE_HALF_UNITS);
}

/** Fill is the placed volume over the kiln's usable volume, as a whole percent. */
export function fillPercent(placed: PlacedPiece[], usableCubicInches: number): number {
  const totalMilli = placed.reduce((sum, piece) => sum + piece.cubicMilli, 0);
  return Math.floor((2 * totalMilli + usableCubicInches * 10) / (2 * usableCubicInches * 10));
}
