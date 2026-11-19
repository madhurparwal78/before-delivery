/**
 * The hide and its pattern pieces, as both the server and the browser read
 * them. Only the server decides whether a placement is allowed.
 */

export const HIDE_WIDTH_CM = 200;
export const HIDE_HEIGHT_CM = 240;

export type PieceName = 'Seat' | 'Back' | 'Left side' | 'Right side' | 'Headrest';

/** The published order: choosing, overlap testing and the tray all use it. */
export const PIECE_NAMES: readonly PieceName[] = [
  'Seat',
  'Back',
  'Left side',
  'Right side',
  'Headrest',
];

export interface PatternSpec {
  readonly width: number;
  readonly height: number;
  /** A piece that runs with the grain turns only 0 or 180. */
  readonly withGrain: boolean;
}

export const PATTERN: Record<PieceName, PatternSpec> = {
  Seat: { width: 62, height: 58, withGrain: true },
  Back: { width: 62, height: 74, withGrain: true },
  'Left side': { width: 30, height: 74, withGrain: true },
  'Right side': { width: 30, height: 74, withGrain: true },
  Headrest: { width: 40, height: 22, withGrain: false },
};

export function isPieceName(value: string): value is PieceName {
  return (PIECE_NAMES as readonly string[]).includes(value);
}

/** Rotation turns the box about its top-left, so 90 and 270 swap the sides. */
export function boxOf(name: PieceName, rotation: number): { width: number; height: number } {
  const spec = PATTERN[name];
  return rotation === 90 || rotation === 270
    ? { width: spec.height, height: spec.width }
    : { width: spec.width, height: spec.height };
}

export function allowedRotations(name: PieceName): readonly number[] {
  return PATTERN[name].withGrain ? [0, 180] : [0, 90, 180, 270];
}
