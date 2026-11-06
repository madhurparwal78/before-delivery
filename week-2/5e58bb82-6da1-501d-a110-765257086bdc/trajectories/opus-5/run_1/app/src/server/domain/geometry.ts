import type { Position } from '../../shared/types.js';

export interface Vec {
  e: number;
  n: number;
}

const TOUCH = 1e-9;

/** Along-line and across-line directions for an azimuth in degrees clockwise from grid north. */
export function directions(azimuthDeg: number): { along: Vec; across: Vec } {
  const a = (azimuthDeg * Math.PI) / 180;
  return {
    along: { e: Math.sin(a), n: Math.cos(a) },
    across: { e: Math.cos(a), n: -Math.sin(a) },
  };
}

export function project(point: Position, direction: Vec): number {
  return point.easting * direction.e + point.northing * direction.n;
}

export function spread(points: Position[], direction: Vec): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = project(point, direction);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Twice the signed area of a simple polygon, positive when counter-clockwise. */
export function signedArea2(polygon: Position[]): number {
  let total = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    total += a.easting * b.northing - b.easting * a.northing;
  }
  return total;
}

export function polygonArea(polygon: Position[]): number {
  return Math.abs(signedArea2(polygon)) / 2;
}

/** A polygon is convex when every turn keeps one sign and no vertex repeats. */
export function isConvex(polygon: Position[]): boolean {
  if (polygon.length < 3) return false;
  const count = polygon.length;
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % count]!;
    if (Math.abs(a.easting - b.easting) < TOUCH && Math.abs(a.northing - b.northing) < TOUCH) {
      return false;
    }
  }
  let sign = 0;
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % count]!;
    const c = polygon[(i + 2) % count]!;
    const cross =
      (b.easting - a.easting) * (c.northing - b.northing) -
      (b.northing - a.northing) * (c.easting - b.easting);
    if (Math.abs(cross) <= TOUCH) continue;
    const next = cross > 0 ? 1 : -1;
    if (sign === 0) sign = next;
    else if (sign !== next) return false;
  }
  return sign !== 0;
}

/** True when the point lies inside the polygon or on its edge. */
export function containsPoint(polygon: Position[], point: Position): boolean {
  const orientation = signedArea2(polygon) >= 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross =
      (b.easting - a.easting) * (point.northing - a.northing) -
      (b.northing - a.northing) * (point.easting - a.easting);
    if (cross * orientation < -TOUCH) return false;
  }
  return true;
}

export interface Chord {
  start: Position;
  end: Position;
  length: number;
  alongMin: number;
  alongMax: number;
}

/**
 * The chord of a convex polygon cut by the line whose across-projection is
 * `acrossValue`, returned running from the smaller along-projection to the larger.
 */
export function chordAt(
  polygon: Position[],
  along: Vec,
  across: Vec,
  acrossValue: number,
): Chord | null {
  const alongValues: number[] = [];
  const count = polygon.length;
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % count]!;
    const fa = project(a, across) - acrossValue;
    const fb = project(b, across) - acrossValue;
    if (Math.abs(fa) <= TOUCH) alongValues.push(project(a, along));
    if (Math.abs(fa) > TOUCH && Math.abs(fb) > TOUCH && fa * fb < 0) {
      const ratio = fa / (fa - fb);
      const point: Position = {
        easting: a.easting + (b.easting - a.easting) * ratio,
        northing: a.northing + (b.northing - a.northing) * ratio,
      };
      alongValues.push(project(point, along));
    }
  }
  if (alongValues.length === 0) return null;
  const alongMin = Math.min(...alongValues);
  const alongMax = Math.max(...alongValues);
  return {
    start: pointAt(along, across, alongMin, acrossValue),
    end: pointAt(along, across, alongMax, acrossValue),
    length: alongMax - alongMin,
    alongMin,
    alongMax,
  };
}

/** The grid point with the given along and across projections. */
export function pointAt(
  along: Vec,
  across: Vec,
  alongValue: number,
  acrossValue: number,
): Position {
  return {
    easting: along.e * alongValue + across.e * acrossValue,
    northing: along.n * alongValue + across.n * acrossValue,
  };
}

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.easting - b.easting, a.northing - b.northing);
}

/**
 * Heading deviation from a line direction, folded to 0..90 so that reciprocal
 * headings count as equal.
 */
export function headingDeviation(headingDeg: number, directionDeg: number): number {
  const delta = (((headingDeg - directionDeg) % 180) + 180) % 180;
  return Math.min(delta, 180 - delta);
}
