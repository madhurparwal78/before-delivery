import type { DimensionKind, Point } from '../shared/api';
import { BLOCK_LIBRARY, isBlockName, type BlockPart } from './blocks';

export const EPS = 1e-7;

export const DEG = Math.PI / 180;

export function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scaled(a: Point, k: number): Point {
  return [a[0] * k, a[1] * k];
}

export function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function norm(a: Point): number {
  return Math.hypot(a[0], a[1]);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function samePoint(a: Point, b: Point, tolerance = 1e-6): boolean {
  return distance(a, b) <= tolerance;
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function roundPoint(point: Point): Point {
  return [round6(point[0]), round6(point[1])];
}

export function degrees(radians: number): number {
  return radians / DEG;
}

export function wrap360(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function angleOf(vector: Point): number {
  return wrap360(degrees(Math.atan2(vector[1], vector[0])));
}

export function polar(center: Point, radius: number, angleDegrees: number): Point {
  return [center[0] + radius * Math.cos(angleDegrees * DEG), center[1] + radius * Math.sin(angleDegrees * DEG)];
}

export function rotateAbout(point: Point, base: Point, angleDegrees: number): Point {
  const c = Math.cos(angleDegrees * DEG);
  const s = Math.sin(angleDegrees * DEG);
  const d = sub(point, base);
  return [base[0] + d[0] * c - d[1] * s, base[1] + d[0] * s + d[1] * c];
}

export function mirrorAbout(point: Point, first: Point, second: Point): Point {
  const axis = sub(second, first);
  const length = norm(axis);
  if (length < EPS) return point;
  const unit: Point = scaled(axis, 1 / length);
  const relative = sub(point, first);
  const along = dot(relative, unit);
  const projection = add(first, scaled(unit, along));
  return [2 * projection[0] - point[0], 2 * projection[1] - point[1]];
}

// ---------------------------------------------------------------------------
// Curves: every object reduces to segments and arcs for snaps, intersections,
// distances, extents and trimming.
// ---------------------------------------------------------------------------

export type Curve =
  | { kind: 'segment'; a: Point; b: Point }
  | { kind: 'arc'; c: Point; r: number; start: number; sweep: number };

export function arcSweep(startAngle: number, endAngle: number): number {
  const sweep = wrap360(endAngle - startAngle);
  return sweep < EPS ? 360 : sweep;
}

export function arcContains(curve: { start: number; sweep: number }, angle: number): boolean {
  if (curve.sweep >= 360 - EPS) return true;
  const offset = wrap360(angle - curve.start);
  return offset <= curve.sweep + 1e-6 || offset >= 360 - 1e-6;
}

export function arcEndpoints(curve: { c: Point; r: number; start: number; sweep: number }): [Point, Point] {
  return [polar(curve.c, curve.r, curve.start), polar(curve.c, curve.r, curve.start + curve.sweep)];
}

export function closestOnSegment(point: Point, a: Point, b: Point): { point: Point; t: number } {
  const axis = sub(b, a);
  const lengthSquared = dot(axis, axis);
  if (lengthSquared < EPS) return { point: a, t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(point, a), axis) / lengthSquared));
  return { point: add(a, scaled(axis, t)), t };
}

export function distanceToCurve(point: Point, curve: Curve): number {
  if (curve.kind === 'segment') return distance(point, closestOnSegment(point, curve.a, curve.b).point);
  const toCentre = sub(point, curve.c);
  const angle = angleOf(toCentre);
  if (arcContains(curve, angle)) return Math.abs(norm(toCentre) - curve.r);
  const [from, to] = arcEndpoints(curve);
  return Math.min(distance(point, from), distance(point, to));
}

function segmentSegment(a: Point, b: Point, c: Point, d: Point): Point[] {
  const r = sub(b, a);
  const s = sub(d, c);
  const denominator = cross(r, s);
  const ac = sub(c, a);
  if (Math.abs(denominator) < EPS) {
    if (Math.abs(cross(ac, r)) > 1e-6) return [];
    const rr = dot(r, r);
    if (rr < EPS) return [];
    const points: Point[] = [];
    for (const candidate of [c, d]) {
      const t = dot(sub(candidate, a), r) / rr;
      if (t >= -1e-9 && t <= 1 + 1e-9) points.push(candidate);
    }
    for (const candidate of [a, b]) {
      const ss = dot(s, s);
      const t = dot(sub(candidate, c), s) / ss;
      if (t >= -1e-9 && t <= 1 + 1e-9) points.push(candidate);
    }
    return points;
  }
  const t = cross(ac, s) / denominator;
  const u = cross(ac, r) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
  return [add(a, scaled(r, t))];
}

function segmentArc(a: Point, b: Point, arc: { c: Point; r: number; start: number; sweep: number }): Point[] {
  const d = sub(b, a);
  const f = sub(a, arc.c);
  const quadA = dot(d, d);
  if (quadA < EPS) return [];
  const quadB = 2 * dot(f, d);
  const quadC = dot(f, f) - arc.r * arc.r;
  const discriminant = quadB * quadB - 4 * quadA * quadC;
  if (discriminant < -1e-9) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const results: Point[] = [];
  for (const t of [(-quadB - root) / (2 * quadA), (-quadB + root) / (2 * quadA)]) {
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const point = add(a, scaled(d, t));
    if (arcContains(arc, angleOf(sub(point, arc.c)))) results.push(point);
  }
  return results;
}

function arcArc(
  first: { c: Point; r: number; start: number; sweep: number },
  second: { c: Point; r: number; start: number; sweep: number },
): Point[] {
  const between = sub(second.c, first.c);
  const span = norm(between);
  if (span < EPS) return [];
  if (span > first.r + second.r + 1e-9 || span < Math.abs(first.r - second.r) - 1e-9) return [];
  const a = (first.r * first.r - second.r * second.r + span * span) / (2 * span);
  const hSquared = first.r * first.r - a * a;
  const h = Math.sqrt(Math.max(0, hSquared));
  const unit: Point = scaled(between, 1 / span);
  const mid = add(first.c, scaled(unit, a));
  const offsets: Point[] = h < 1e-9 ? [[0, 0]] : [
    [-unit[1] * h, unit[0] * h],
    [unit[1] * h, -unit[0] * h],
  ];
  const results: Point[] = [];
  for (const offset of offsets) {
    const point = add(mid, offset);
    if (
      arcContains(first, angleOf(sub(point, first.c))) &&
      arcContains(second, angleOf(sub(point, second.c)))
    ) {
      results.push(point);
    }
  }
  return results;
}

export function curveIntersections(first: Curve, second: Curve): Point[] {
  if (first.kind === 'segment' && second.kind === 'segment') {
    return segmentSegment(first.a, first.b, second.a, second.b);
  }
  if (first.kind === 'segment' && second.kind === 'arc') return segmentArc(first.a, first.b, second);
  if (first.kind === 'arc' && second.kind === 'segment') return segmentArc(second.a, second.b, first);
  if (first.kind === 'arc' && second.kind === 'arc') return arcArc(first, second);
  return [];
}

export function curveExtents(curve: Curve): { min: Point; max: Point } {
  if (curve.kind === 'segment') {
    return {
      min: [Math.min(curve.a[0], curve.b[0]), Math.min(curve.a[1], curve.b[1])],
      max: [Math.max(curve.a[0], curve.b[0]), Math.max(curve.a[1], curve.b[1])],
    };
  }
  const points: Point[] = [...arcEndpoints(curve)];
  for (const axis of [0, 90, 180, 270]) {
    if (arcContains(curve, axis)) points.push(polar(curve.c, curve.r, axis));
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

// ---------------------------------------------------------------------------
// Block geometry
// ---------------------------------------------------------------------------

export interface InsertPlacement {
  block: string;
  position: Point;
  scale: number;
  rotation: number;
}

/** Places a block part: scale about the base point, then rotate, then translate. */
function placePoint(local: Point, placement: InsertPlacement): Point {
  const scaledPoint: Point = [local[0] * placement.scale, local[1] * placement.scale];
  const rotated = rotateAbout(scaledPoint, [0, 0], placement.rotation);
  return add(placement.position, rotated);
}

export interface PlacedPart {
  part: BlockPart;
  curves: Curve[];
  endpoints: Point[];
  midpoints: Point[];
  centers: Point[];
}

export function placedBlockParts(placement: InsertPlacement): PlacedPart[] {
  if (!isBlockName(placement.block)) return [];
  const placed: PlacedPart[] = [];
  for (const part of BLOCK_LIBRARY[placement.block]) {
    if (part.kind === 'line') {
      const a = placePoint(part.start, placement);
      const b = placePoint(part.end, placement);
      placed.push({
        part: { kind: 'line', start: a, end: b },
        curves: [{ kind: 'segment', a, b }],
        endpoints: [a, b],
        midpoints: [scaled(add(a, b), 0.5)],
        centers: [],
      });
    } else if (part.kind === 'arc') {
      const center = placePoint(part.center, placement);
      const radius = part.radius * placement.scale;
      const start = wrap360(part.start_angle + placement.rotation);
      const sweep = arcSweep(part.start_angle, part.end_angle);
      const curve: Curve = { kind: 'arc', c: center, r: radius, start, sweep };
      placed.push({
        part: { kind: 'arc', center, radius, start_angle: start, end_angle: wrap360(start + sweep) },
        curves: [curve],
        endpoints: arcEndpoints({ c: center, r: radius, start, sweep }),
        midpoints: [polar(center, radius, start + sweep / 2)],
        centers: [center],
      });
    } else if (part.kind === 'polyline') {
      const vertices = part.vertices.map((vertex) => placePoint(vertex, placement));
      const curves = polylineCurves(vertices, part.closed);
      placed.push({
        part: { kind: 'polyline', vertices, closed: part.closed },
        curves,
        endpoints: vertices,
        midpoints: curves.map((curve) =>
          curve.kind === 'segment' ? scaled(add(curve.a, curve.b), 0.5) : curve.c,
        ),
        centers: [],
      });
    } else {
      const position = placePoint(part.position, placement);
      placed.push({
        part: { kind: 'mtext', position, height: part.height * placement.scale, contents: part.contents },
        curves: [],
        endpoints: [],
        midpoints: [],
        centers: [],
      });
    }
  }
  return placed;
}

export function polylineCurves(vertices: Point[], closed: boolean): Curve[] {
  const curves: Curve[] = [];
  for (let i = 0; i < vertices.length - 1; i += 1) {
    curves.push({ kind: 'segment', a: vertices[i]!, b: vertices[i + 1]! });
  }
  if (closed && vertices.length > 2) {
    curves.push({ kind: 'segment', a: vertices.at(-1)!, b: vertices[0]! });
  }
  return curves;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export function polylineLength(vertices: Point[], closed: boolean): number {
  return polylineCurves(vertices, closed).reduce(
    (total, curve) => total + (curve.kind === 'segment' ? distance(curve.a, curve.b) : 0),
    0,
  );
}

export function polygonArea(vertices: Point[]): number {
  let twice = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    twice += cross(a, b);
  }
  return Math.abs(twice) / 2;
}

export function arcLength(radius: number, startAngle: number, endAngle: number): number {
  return radius * arcSweep(startAngle, endAngle) * DEG;
}

export function revcloudArcs(first: Point, opposite: Point): number {
  const width = Math.abs(opposite[0] - first[0]);
  const height = Math.abs(opposite[1] - first[1]);
  const perSide = (side: number) => Math.max(1, Math.ceil(side / 150));
  return 2 * perSide(width) + 2 * perSide(height);
}

export function revcloudStrokes(first: Point, opposite: Point): Curve[] {
  const x0 = Math.min(first[0], opposite[0]);
  const x1 = Math.max(first[0], opposite[0]);
  const y0 = Math.min(first[1], opposite[1]);
  const y1 = Math.max(first[1], opposite[1]);
  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const strokes: Curve[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const sideLength = distance(a, b);
    const count = Math.max(1, Math.ceil(sideLength / 150));
    for (let k = 0; k < count; k += 1) {
      const from = add(a, scaled(sub(b, a), k / count));
      const to = add(a, scaled(sub(b, a), (k + 1) / count));
      const centre = scaled(add(from, to), 0.5);
      const radius = distance(from, to) / 2;
      const base = angleOf(sub(to, from));
      strokes.push({ kind: 'arc', c: centre, r: radius, start: base, sweep: 180 });
    }
  }
  return strokes;
}

/** DIMLINEAR measures |Δx| or |Δy| by where the dimension line sits. */
export function linearMeasurement(first: Point, second: Point, location: Point): number {
  const deltaX = Math.abs(second[0] - first[0]);
  const deltaY = Math.abs(second[1] - first[1]);
  const aboveOrBelow = location[1] > Math.max(first[1], second[1]) || location[1] < Math.min(first[1], second[1]);
  if (aboveOrBelow) return deltaX;
  const leftOrRight = location[0] < Math.min(first[0], second[0]) || location[0] > Math.max(first[0], second[0]);
  if (leftOrRight) return deltaY;
  return deltaX;
}

export function alignedMeasurement(first: Point, second: Point): number {
  return distance(first, second);
}

/** The angle between two lines, 0 to 180, in the quadrant that holds the location. */
export function angularMeasurement(
  firstLine: { start: Point; end: Point },
  secondLine: { start: Point; end: Point },
  location: Point,
): number {
  const d1 = sub(firstLine.end, firstLine.start);
  const d2 = sub(secondLine.end, secondLine.start);
  const denominator = cross(d1, d2);
  const apex =
    Math.abs(denominator) < EPS
      ? scaled(add(firstLine.start, secondLine.start), 0.5)
      : add(firstLine.start, scaled(d1, cross(sub(secondLine.start, firstLine.start), d2) / denominator));
  const toLocation = sub(location, apex);
  const pick = (direction: Point): Point => (dot(direction, toLocation) >= 0 ? direction : scaled(direction, -1));
  const a1 = angleOf(pick(d1));
  const a2 = angleOf(pick(d2));
  const difference = Math.abs(wrap360(a2 - a1));
  return difference > 180 ? 360 - difference : difference;
}

export function dimensionMeasurement(
  kind: DimensionKind,
  points: Point[],
  location: Point,
  radius: number | null,
  lines: Array<{ start: Point; end: Point }>,
): number {
  if (kind === 'linear') return linearMeasurement(points[0]!, points[1]!, location);
  if (kind === 'aligned') return alignedMeasurement(points[0]!, points[1]!);
  if (kind === 'radius') return radius ?? 0;
  return angularMeasurement(lines[0]!, lines[1]!, location);
}

export interface Extents {
  min: Point;
  max: Point;
}

export function mergeExtents(boxes: Extents[]): Extents | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.min[0]);
    minY = Math.min(minY, box.min[1]);
    maxX = Math.max(maxX, box.max[0]);
    maxY = Math.max(maxY, box.max[1]);
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

/** Where a point falls along a segment, as a fraction from 0 at `a` to 1 at `b`. */
export function segmentParameter(a: Point, b: Point, point: Point): number {
  const axis = sub(b, a);
  const lengthSquared = dot(axis, axis);
  if (lengthSquared < EPS) return 0;
  return dot(sub(point, a), axis) / lengthSquared;
}

/** Where a point falls along a polyline, as a distance from its first vertex. */
export function polylineParameter(vertices: Point[], closed: boolean, point: Point): number {
  const curves = polylineCurves(vertices, closed);
  let travelled = 0;
  let best = { parameter: 0, gap: Infinity };
  for (const curve of curves) {
    if (curve.kind !== 'segment') continue;
    const segmentLength = distance(curve.a, curve.b);
    const nearest = closestOnSegment(point, curve.a, curve.b);
    const gap = distance(point, nearest.point);
    if (gap < best.gap) best = { parameter: travelled + nearest.t * segmentLength, gap };
    travelled += segmentLength;
  }
  return best.parameter;
}

export function polylinePointAt(vertices: Point[], closed: boolean, parameter: number): Point {
  const curves = polylineCurves(vertices, closed);
  let travelled = 0;
  for (const curve of curves) {
    if (curve.kind !== 'segment') continue;
    const segmentLength = distance(curve.a, curve.b);
    if (parameter <= travelled + segmentLength || curve === curves.at(-1)) {
      const local = segmentLength < EPS ? 0 : (parameter - travelled) / segmentLength;
      return add(curve.a, scaled(sub(curve.b, curve.a), Math.min(1, Math.max(0, local))));
    }
    travelled += segmentLength;
  }
  return vertices[0]!;
}

/** The vertices of the part of a polyline between two distance parameters. */
export function polylineSlice(vertices: Point[], closed: boolean, from: number, to: number): Point[] {
  const curves = polylineCurves(vertices, closed);
  const result: Point[] = [polylinePointAt(vertices, closed, from)];
  let travelled = 0;
  for (const curve of curves) {
    if (curve.kind !== 'segment') continue;
    const segmentLength = distance(curve.a, curve.b);
    const vertexParameter = travelled + segmentLength;
    if (vertexParameter > from + 1e-6 && vertexParameter < to - 1e-6) result.push(curve.b);
    travelled = vertexParameter;
  }
  result.push(polylinePointAt(vertices, closed, to));
  return result;
}
