import type { Point } from '../types.ts';

/** Tolerance for every comparison (brief: Coordinates and display). */
export const TOL = 0.001;
/** Tolerance of the constraint solver (brief: Constraints and parameters). */
export const SOLVE_TOL = 0.0001;

/** Rounds half away from zero; the 15-digit step keeps products like 1.0005 * 1000 from landing below the half. */
function roundHalfAway(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(n) * factor).toPrecision(15));
  const rounded = (Math.sign(n) * Math.round(scaled)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Stored numbers: rounded to 6 decimals, half away from zero. */
export function round6(n: number): number {
  return roundHalfAway(n, 6);
}

/** Visible text: 3 decimals, trailing zeros trimmed, `-0` shown as `0`. */
export function fmt3(n: number): string {
  return String(roundHalfAway(n, 3));
}

/** Angles in DIST results and arc labels: 2 decimals, trailing zeros trimmed. */
export function fmtAngle(n: number): string {
  return String(roundHalfAway(n, 2));
}

/** Data attributes: the stored number (6 decimals) with trailing zeros trimmed. */
export function fmtData(n: number): string {
  return String(round6(n));
}

/** Dimension values: the style's precision, rounded half away from zero, trailing zeros kept (`10.00`). */
export function fmtFixed(n: number, precision: number): string {
  return roundHalfAway(n, precision).toFixed(precision);
}

/** Degrees into [0, 360). */
export function normalizeAngle(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned >= 360 ? 0 : turned;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const OPTIMISTIC_PREFIX = 'new-';

/** The handle a browser gives an entity it adds before the server answers; the answer replaces it. */
export const optimisticHandle = (n: number): string => `${OPTIMISTIC_PREFIX}${n}`;
export const isOptimisticHandle = (handle: string): boolean => handle.startsWith(OPTIMISTIC_PREFIX);

/** The number of a handle: `L12` -> 12, `Site|L12` -> 12, `new-3` -> 3. */
export function handleNumber(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match === null ? 0 : Number(match[1]);
}

/** Entity list order: real handles by number, optimistic `new-<n>` ids after them by n. */
export function compareHandles(a: string, b: string): number {
  const optimisticA = isOptimisticHandle(a);
  const optimisticB = isOptimisticHandle(b);
  if (optimisticA !== optimisticB) return optimisticA ? 1 : -1;
  const byNumber = handleNumber(a) - handleNumber(b);
  if (byNumber !== 0) return byNumber;
  return a < b ? -1 : a > b ? 1 : 0;
}

export const RAD = Math.PI / 180;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** `p` turned counter-clockwise by `degrees` about `about`. */
export function rotateAbout(p: Point, about: Point, degrees: number): Point {
  const cos = Math.cos(degrees * RAD);
  const sin = Math.sin(degrees * RAD);
  const dx = p[0] - about[0];
  const dy = p[1] - about[1];
  return [about[0] + dx * cos - dy * sin, about[1] + dx * sin + dy * cos];
}

export function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Direction from `from` to `to` in degrees counter-clockwise from +X, in [0, 360). */
export function directionDeg(from: Point, to: Point): number {
  return normalizeAngle(Math.atan2(to[1] - from[1], to[0] - from[0]) / RAD);
}

export function pointAtAngle(centre: Point, radius: number, degrees: number): Point {
  return [centre[0] + radius * Math.cos(degrees * RAD), centre[1] + radius * Math.sin(degrees * RAD)];
}

export function roundPoint(p: Point): Point {
  return [round6(p[0]), round6(p[1])];
}

/** DIST (brief: Geometry commands): the distance and the direction angle from `a` to `b`, from 0 up to 360 degrees. */
export function measureDistance(a: Point, b: Point): { distance: number; angle: number } {
  return { distance: distance(a, b), angle: directionDeg(a, b) };
}
