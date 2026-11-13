// Curve maths on world-space primitives: closest points, intersections, extents. Every geometry command, snap, pick and window test builds on it.
import type { Point, Rect } from '../types.ts';
import { RAD, clamp, directionDeg, distance, normalizeAngle, pointAtAngle } from './numbers.ts';

/** Geometry for hit tests, snaps and window selection, in world space. */
export type Prim =
  | { kind: 'segment'; a: Point; b: Point }
  | { kind: 'circle'; c: Point; r: number }
  | { kind: 'arc'; c: Point; r: number; start: number; end: number };

type Round = Extract<Prim, { kind: 'circle' | 'arc' }>;

const ANGLE_EPS = 1e-7;
const PARAM_EPS = 1e-9;

/** Counter-clockwise degrees from `from` to `to`, in [0, 360). */
export function ccwDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** The sweep of an arc: counter-clockwise from start to end; an arc whose ends coincide sweeps the full circle. */
export function arcSweep(start: number, end: number): number {
  return ccwDelta(start, end) || 360;
}

/** True when direction `degrees` lies on the counter-clockwise arc from `start` to `end`. */
export function onArc(degrees: number, start: number, end: number): boolean {
  const d = ccwDelta(start, degrees);
  return d <= arcSweep(start, end) + ANGLE_EPS || d >= 360 - ANGLE_EPS;
}

export function arcEnds(arc: Extract<Prim, { kind: 'arc' }>): [Point, Point] {
  return [pointAtAngle(arc.c, arc.r, arc.start), pointAtAngle(arc.c, arc.r, arc.end)];
}

export function arcMid(arc: Extract<Prim, { kind: 'arc' }>): Point {
  return pointAtAngle(arc.c, arc.r, arc.start + arcSweep(arc.start, arc.end) / 2);
}

export const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

/** Parameter t of the point on the infinite line a-b closest to p (0 at a, 1 at b). */
export function lineParameter(a: Point, b: Point, p: Point): number {
  const d = sub(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  return len2 === 0 ? 0 : ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2;
}

export function pointOnLine(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function closestOnSegment(a: Point, b: Point, p: Point): Point {
  const t = clamp(lineParameter(a, b, p), 0, 1);
  return pointOnLine(a, b, t);
}

/** The crossing of the infinite lines a-b and c-d, with the parameter along each; null when parallel. */
export function lineCrossing(a: Point, b: Point, c: Point, d: Point): { point: Point; t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12 * (Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1]) || 1)) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  return { point: pointOnLine(a, b, t), t, u };
}

function segmentSegment(a: Point, b: Point, c: Point, d: Point): Point[] {
  const crossing = lineCrossing(a, b, c, d);
  if (crossing === null) return [];
  const { t, u } = crossing;
  const inside = (v: number): boolean => v >= -PARAM_EPS && v <= 1 + PARAM_EPS;
  return inside(t) && inside(u) ? [crossing.point] : [];
}

function lineCircle(a: Point, b: Point, c: Point, r: number): { point: Point; t: number }[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const qa = d[0] * d[0] + d[1] * d[1];
  const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
  const qc = f[0] * f[0] + f[1] * f[1] - r * r;
  const discriminant = qb * qb - 4 * qa * qc;
  if (qa === 0 || discriminant < -1e-9 * Math.max(1, qb * qb)) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const params = root === 0 ? [-qb / (2 * qa)] : [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)];
  return params.map((t) => ({ point: pointOnLine(a, b, t), t }));
}

function circleCircle(c1: Point, r1: number, c2: Point, r2: number): Point[] {
  const d = distance(c1, c2);
  if (d === 0 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const along = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const height = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const ux = (c2[0] - c1[0]) / d;
  const uy = (c2[1] - c1[1]) / d;
  const base: Point = [c1[0] + ux * along, c1[1] + uy * along];
  if (height === 0) return [base];
  return [[base[0] - uy * height, base[1] + ux * height], [base[0] + uy * height, base[1] - ux * height]];
}

function onRound(round: Round, p: Point): boolean {
  return round.kind === 'circle' || onArc(directionDeg(round.c, p), round.start, round.end);
}

/** The real crossings of two primitives (segments are finite, arcs are limited to their sweep). */
export function intersections(first: Prim, second: Prim): Point[] {
  if (first.kind === 'segment') {
    if (second.kind === 'segment') return segmentSegment(first.a, first.b, second.a, second.b);
    return lineCircle(first.a, first.b, second.c, second.r)
      .filter(({ t }) => t >= -PARAM_EPS && t <= 1 + PARAM_EPS)
      .map(({ point }) => point)
      .filter((p) => onRound(second, p));
  }
  if (second.kind === 'segment') return intersections(second, first);
  return circleCircle(first.c, first.r, second.c, second.r).filter((p) => onRound(first, p) && onRound(second, p));
}

/** The closest point of a primitive to `p`. */
export function closestPoint(prim: Prim, p: Point): Point {
  if (prim.kind === 'segment') return closestOnSegment(prim.a, prim.b, p);
  if (distance(prim.c, p) === 0) return pointAtAngle(prim.c, prim.r, prim.kind === 'arc' ? prim.start : 0);
  const angle = directionDeg(prim.c, p);
  if (prim.kind === 'circle' || onArc(angle, prim.start, prim.end)) return pointAtAngle(prim.c, prim.r, angle);
  const [s, e] = arcEnds(prim);
  return distance(p, s) <= distance(p, e) ? s : e;
}

export function distanceToPrim(prim: Prim, p: Point): number {
  return distance(closestPoint(prim, p), p);
}

/** The rectangle with the two points as opposite corners, in either order. */
export function rectBetween(a: Point, b: Point): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function unionRect(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function rectsMeet(a: Rect, b: Rect, slack = 0): boolean {
  return a[0] <= b[2] + slack && a[2] >= b[0] - slack && a[1] <= b[3] + slack && a[3] >= b[1] - slack;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function pointInRect(rect: Rect, p: Point): boolean {
  return p[0] >= rect[0] && p[0] <= rect[2] && p[1] >= rect[1] && p[1] <= rect[3];
}

export function pointRect(p: Point): Rect {
  return [p[0], p[1], p[0], p[1]];
}

export function primBounds(prim: Prim): Rect {
  if (prim.kind === 'segment') return rectBetween(prim.a, prim.b);
  if (prim.kind === 'circle') return [prim.c[0] - prim.r, prim.c[1] - prim.r, prim.c[0] + prim.r, prim.c[1] + prim.r];
  const [s, e] = arcEnds(prim);
  let bounds = rectBetween(s, e);
  for (const quadrant of [0, 90, 180, 270]) {
    if (onArc(quadrant, prim.start, prim.end)) bounds = unionRect(bounds, pointRect(pointAtAngle(prim.c, prim.r, quadrant)));
  }
  return bounds;
}

function rectEdges(rect: Rect): Prim[] {
  const [x1, y1, x2, y2] = rect;
  return [
    { kind: 'segment', a: [x1, y1], b: [x2, y1] }, { kind: 'segment', a: [x2, y1], b: [x2, y2] },
    { kind: 'segment', a: [x2, y2], b: [x1, y2] }, { kind: 'segment', a: [x1, y2], b: [x1, y1] },
  ];
}

/** True when any part of the primitive lies inside or on the rectangle (crossing selection). */
export function primTouchesRect(prim: Prim, rect: Rect): boolean {
  if (!rectsMeet(primBounds(prim), rect)) return false;
  const first: Point = prim.kind === 'segment' ? prim.a : pointAtAngle(prim.c, prim.r, prim.kind === 'arc' ? prim.start : 0);
  if (pointInRect(rect, first) || (prim.kind === 'segment' && pointInRect(rect, prim.b))) return true;
  return rectEdges(rect).some((edge) => intersections(prim, edge).length > 0);
}

/** The two tangent points from `from` to a circle; empty when `from` is inside it. */
export function tangentPoints(from: Point, centre: Point, radius: number): Point[] {
  const d = distance(from, centre);
  if (d < radius) return [];
  const alpha = Math.acos(Math.min(1, radius / d)) / RAD;
  const base = directionDeg(centre, from);
  return [pointAtAngle(centre, radius, base + alpha), pointAtAngle(centre, radius, base - alpha)];
}

/** Even-odd test of a point against a polygon given as a vertex ring. */
export function pointInPolygon(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
