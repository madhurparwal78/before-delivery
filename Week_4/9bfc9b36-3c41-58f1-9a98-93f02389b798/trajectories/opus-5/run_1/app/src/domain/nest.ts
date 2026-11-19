import type { PanelGeometry, Point } from './panels';

/**
 * The one place that turns a panel, tests whether two outlines overlap, and
 * searches for a panel's automatic first-fit position on a hold.
 */

export type Rotation = 0 | 180;

export interface Placement {
  readonly x_mm: number;
  readonly y_mm: number;
  readonly rotation: Rotation;
}

export interface LaidOutline {
  readonly panel_number: number;
  readonly outline: readonly Point[];
}

/** The panel's outline at 0° or 180°, still in the panel's own frame. */
export function turnedOutline(panel: PanelGeometry, rotation: Rotation): Point[] {
  if (rotation === 0) return panel.outline.map((point) => [point[0], point[1]] as Point);
  return panel.outline.map((point) => [panel.length_mm - point[0], panel.width_mm - point[1]] as Point);
}

/** The panel's outline in the claim frame, turned and offset. */
export function placedOutline(panel: PanelGeometry, rotation: Rotation, xMm: number, yMm: number): Point[] {
  return turnedOutline(panel, rotation).map((point) => [point[0] + xMm, point[1] + yMm] as Point);
}

export function outlineBounds(outline: readonly Point[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of outline) {
    if (point[0] < minX) minX = point[0];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[1] > maxY) maxY = point[1];
  }
  return { minX, maxX, minY, maxY };
}

/** True when the whole outline lies inside the claimed length and usable width. */
export function insideCloth(outline: readonly Point[], claimLengthMm: number, usableWidthMm: number): boolean {
  const bounds = outlineBounds(outline);
  return bounds.minX >= 0 && bounds.maxX <= claimLengthMm && bounds.minY >= 0 && bounds.maxY <= usableWidthMm;
}

/**
 * Projects an outline onto an axis, in whole numbers.
 * The axis is an edge normal, so the projection is exact.
 */
function project(outline: readonly Point[], axisX: number, axisY: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of outline) {
    const value = point[0] * axisX + point[1] * axisY;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function separatedOnEdgeNormals(
  edgesOf: readonly Point[],
  a: readonly Point[],
  b: readonly Point[],
): boolean {
  for (let i = 0; i < edgesOf.length; i += 1) {
    const here = edgesOf[i] as Point;
    const next = edgesOf[(i + 1) % edgesOf.length] as Point;
    const edgeX = next[0] - here[0];
    const edgeY = next[1] - here[1];
    if (edgeX === 0 && edgeY === 0) continue;
    const axisX = -edgeY;
    const axisY = edgeX;
    const pa = project(a, axisX, axisY);
    const pb = project(b, axisX, axisY);
    if (pa.max <= pb.min || pb.max <= pa.min) return true;
  }
  return false;
}

/**
 * True when two outlines share an area above zero. Touching at a vertex or along
 * an edge, a shared slanted edge included, is not an overlap. Crosscut panels are
 * convex, so a separating edge normal settles it in exact whole-number arithmetic.
 */
export function outlinesOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (separatedOnEdgeNormals(a, a, b)) return false;
  if (separatedOnEdgeNormals(b, a, b)) return false;
  return true;
}

export function overlapsAnyLaid(
  outline: readonly Point[],
  laid: readonly LaidOutline[],
): LaidOutline | null {
  for (const other of laid) {
    if (outlinesOverlap(outline, other.outline)) return other;
  }
  return null;
}

/**
 * The automatic position: for 0° and then 180°, the smallest whole-mm x at which
 * the turned outline placed at (x, 0) lies inside the claim and clears every
 * outline already laid. The smaller x wins, and a tie goes to 0°.
 */
export function firstFit(
  panel: PanelGeometry,
  laid: readonly LaidOutline[],
  claimLengthMm: number,
  usableWidthMm: number,
): Placement | null {
  let best: Placement | null = null;
  for (const rotation of [0, 180] as const) {
    const turned = turnedOutline(panel, rotation);
    const bounds = outlineBounds(turned);
    if (bounds.maxY > usableWidthMm || bounds.minY < 0) continue;
    const limit = claimLengthMm - bounds.maxX;
    if (limit < 0) continue;
    const x = smallestClearOffset(turned, laid, limit);
    if (x === null) continue;
    if (best === null || x < best.x_mm) best = { x_mm: x, y_mm: 0, rotation };
  }
  return best;
}

function offsetOutline(outline: readonly Point[], xMm: number): Point[] {
  return outline.map((point) => [point[0] + xMm, point[1]] as Point);
}

/**
 * For convex outlines the offsets that overlap a given laid outline form one open
 * interval, so once an offset has cleared an outline it never meets it again.
 */
function smallestClearOffset(
  turned: readonly Point[],
  laid: readonly LaidOutline[],
  limit: number,
): number | null {
  let x = 0;
  for (let guard = 0; guard <= laid.length; guard += 1) {
    if (x > limit) return null;
    const blocker = overlapsAnyLaid(offsetOutline(turned, x), laid);
    if (blocker === null) return x;
    const cleared = smallestOffsetClearing(turned, blocker.outline, x, limit);
    if (cleared === null) return null;
    x = cleared;
  }
  return null;
}

function smallestOffsetClearing(
  turned: readonly Point[],
  blocker: readonly Point[],
  from: number,
  limit: number,
): number | null {
  if (!outlinesOverlap(offsetOutline(turned, limit), blocker)) {
    let low = from;
    let high = limit;
    while (low + 1 < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (outlinesOverlap(offsetOutline(turned, middle), blocker)) low = middle;
      else high = middle;
    }
    return high;
  }
  return null;
}
