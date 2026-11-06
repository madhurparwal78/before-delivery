import { roundToTenth } from '../util.js';

/**
 * The angle and alignment rule, the stored-photo bounds check and the readout lines.
 * Angles are computed once on the server when marks are saved; every reader, the
 * browser included, shows the stored values.
 */

export type Hoof = 'LF' | 'RF' | 'LH' | 'RH';
export type Phase = 'before' | 'after';
export type Alignment = 'aligned' | 'broken-back' | 'broken-forward';

export const HOOVES: readonly Hoof[] = ['LF', 'RF', 'LH', 'RH'];
export const PHASES: readonly Phase[] = ['before', 'after'];

export const HOOF_NAMES: Record<Hoof, string> = {
  LF: 'Left fore',
  RF: 'Right fore',
  LH: 'Left hind',
  RH: 'Right hind',
};

export function isHoof(value: unknown): value is Hoof {
  return typeof value === 'string' && (HOOVES as readonly string[]).includes(value);
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Arctangent of |dy| ÷ |dx| in degrees, so a vertical line is 90.0. */
export function lineAngle(line: Line): number {
  const dx = Math.abs(line.x2 - line.x1);
  const dy = Math.abs(line.y2 - line.y1);
  if (dx === 0) return 90;
  return roundToTenth((Math.atan(dy / dx) * 180) / Math.PI);
}

/** The difference d is the hoof-wall angle minus the pastern angle. */
export function alignmentOf(wallAngle: number, pasternAngle: number): Alignment {
  const difference = roundToTenth(wallAngle - pasternAngle);
  if (difference < -3.0) return 'broken-back';
  if (difference > 3.0) return 'broken-forward';
  return 'aligned';
}

/** Both points lie within the stored upright photo and are distinct. */
export function lineFitsPhoto(line: Line, width: number, height: number): boolean {
  const inside = (x: number, y: number): boolean => x >= 0 && x <= width && y >= 0 && y <= height;
  if (!inside(line.x1, line.y1) || !inside(line.x2, line.y2)) return false;
  return line.x1 !== line.x2 || line.y1 !== line.y2;
}

const MINUS = '\u2212';
const ARROW = '\u2192';

/** Each signed difference is current minus previous, with one decimal. */
export function signedDifference(previous: number, current: number): string {
  const difference = roundToTenth(current - previous);
  if (difference === 0) return `\u00b10.0`;
  const sign = difference > 0 ? '+' : MINUS;
  return `${sign}${Math.abs(difference).toFixed(1)}`;
}

export function differenceValue(previous: number, current: number): number {
  return roundToTenth(current - previous);
}

export interface ReadoutSide {
  wallAngle: number;
  pasternAngle: number;
  alignment: Alignment;
}

export function readoutLines(previous: ReadoutSide, current: ReadoutSide): [string, string, string] {
  return [
    `Hoof wall ${previous.wallAngle.toFixed(1)}\u00b0 ${ARROW} ${current.wallAngle.toFixed(1)}\u00b0 ` +
      `(${signedDifference(previous.wallAngle, current.wallAngle)}\u00b0)`,
    `Pastern ${previous.pasternAngle.toFixed(1)}\u00b0 ${ARROW} ${current.pasternAngle.toFixed(1)}\u00b0 ` +
      `(${signedDifference(previous.pasternAngle, current.pasternAngle)}\u00b0)`,
    `Alignment ${previous.alignment} ${ARROW} ${current.alignment}`,
  ];
}
