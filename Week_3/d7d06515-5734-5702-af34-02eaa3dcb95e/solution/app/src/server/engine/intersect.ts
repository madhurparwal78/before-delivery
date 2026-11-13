// Curve intersections: the one place lines, circles and arcs are crossed (snap points, TRIM, EXTEND).
import { angleWithinArc, directionOf, distance, polylineSegments } from '../../shared/geometry.ts';
import { round6 } from '../../shared/format.ts';
import type { Point, Primitive, StoredObject } from '../../shared/types.ts';
import type { DrawingModel } from './types.ts';

export type Curve = Extract<Primitive, { kind: 'line' | 'circle' | 'arc' }>;

/** Distance tolerance in millimetres: touching within this counts as meeting. */
const EPS = 1e-7;
/** The same tolerance as an angle in degrees on a circle of `radius`. */
const arcSlack = (radius: number): number => (EPS / radius) * (180 / Math.PI);

/** Lines, polyline segments, circles and arcs of an object; every other type has no curves to cross. */
export function curvesOf(object: StoredObject): Curve[] {
  switch (object.type) {
    case 'line': return [{ kind: 'line', a: object.start, b: object.end }];
    case 'polyline': return polylineSegments(object.vertices, object.closed).map(([a, b]): Curve => ({ kind: 'line', a, b }));
    case 'circle': return [{ kind: 'circle', center: object.center, radius: object.radius }];
    case 'arc':
      return [{ kind: 'arc', center: object.center, radius: object.radius, start_angle: object.start_angle, end_angle: object.end_angle }];
    default: return [];
  }
}

/** Distances t along the unit `direction` from `origin` where the infinite line meets `curve` (a segment or arc stays bounded). */
export function lineHits(origin: Point, direction: Point, curve: Curve): number[] {
  if (curve.kind === 'line') {
    const ex = curve.b[0] - curve.a[0];
    const ey = curve.b[1] - curve.a[1];
    const length = Math.hypot(ex, ey);
    const cross = direction[0] * ey - direction[1] * ex;
    if (length < 1e-12 || Math.abs(cross) < 1e-12 * length) return [];
    const ox = curve.a[0] - origin[0];
    const oy = curve.a[1] - origin[1];
    const t = (ox * ey - oy * ex) / cross;
    const u = (ox * direction[1] - oy * direction[0]) / cross;
    const slack = EPS / length;
    return u >= -slack && u <= 1 + slack ? [t] : [];
  }
  const fx = origin[0] - curve.center[0];
  const fy = origin[1] - curve.center[1];
  const b = fx * direction[0] + fy * direction[1];
  const discriminant = b * b - (fx * fx + fy * fy - curve.radius * curve.radius);
  if (discriminant < -1e-9 * curve.radius * curve.radius) return [];
  const root = Math.sqrt(Math.max(discriminant, 0));
  const candidates = root < 1e-9 ? [-b] : [-b - root, -b + root];
  if (curve.kind === 'circle') return candidates;
  return candidates.filter((t) => angleWithinArc(
    directionOf(curve.center, [origin[0] + t * direction[0], origin[1] + t * direction[1]]), curve, arcSlack(curve.radius)));
}

const unit = (a: Point, b: Point): Point => {
  const length = distance(a, b);
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};

function circleHits(first: Curve & { kind: 'circle' | 'arc' }, second: Curve & { kind: 'circle' | 'arc' }): Point[] {
  const d = distance(first.center, second.center);
  if (d < 1e-12) return [];
  const along = (first.radius * first.radius - second.radius * second.radius + d * d) / (2 * d);
  const heightSquared = first.radius * first.radius - along * along;
  if (heightSquared < -1e-9 * first.radius * first.radius) return [];
  const height = Math.sqrt(Math.max(heightSquared, 0));
  const ux = (second.center[0] - first.center[0]) / d;
  const uy = (second.center[1] - first.center[1]) / d;
  const mx = first.center[0] + ux * along;
  const my = first.center[1] + uy * along;
  const points: Point[] = height < 1e-9 ? [[mx, my]] : [[mx - uy * height, my + ux * height], [mx + uy * height, my - ux * height]];
  const onArc = (curve: Curve, p: Point): boolean =>
    curve.kind !== 'arc' || angleWithinArc(directionOf(curve.center, p), curve, arcSlack(curve.radius));
  return points.filter((p) => onArc(first, p) && onArc(second, p));
}

/** Points where two curves meet, endpoint contacts included. */
export function intersectCurves(first: Curve, second: Curve): Point[] {
  const [line, other] = first.kind === 'line' ? [first, second] : second.kind === 'line' ? [second, first] : [null, null];
  if (line && other) {
    const length = distance(line.a, line.b);
    if (length < 1e-12) return [];
    const direction = unit(line.a, line.b);
    return lineHits(line.a, direction, other)
      .filter((t) => t >= -EPS && t <= length + EPS)
      .map((t): Point => [line.a[0] + t * direction[0], line.a[1] + t * direction[1]]);
  }
  if (first.kind === 'line' || second.kind === 'line') return [];
  return circleHits(first, second);
}

interface Entry {
  curve: Curve;
  owner: number;
  index: number;
  count: number;
  closed: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function entryOf(curve: Curve, owner: number, index: number, count: number, closed: boolean): Entry {
  const [minX, maxX, minY, maxY] = curve.kind === 'line'
    ? [Math.min(curve.a[0], curve.b[0]), Math.max(curve.a[0], curve.b[0]), Math.min(curve.a[1], curve.b[1]), Math.max(curve.a[1], curve.b[1])]
    : [curve.center[0] - curve.radius, curve.center[0] + curve.radius, curve.center[1] - curve.radius, curve.center[1] + curve.radius];
  return { curve, owner, index, count, closed, minX: minX - EPS, maxX: maxX + EPS, minY: minY - EPS, maxY: maxY + EPS };
}

/** Segments of one polyline that share a vertex meet there by construction; that is a vertex, not an intersection. */
function adjacent(a: Entry, b: Entry): boolean {
  if (a.owner !== b.owner) return false;
  const gap = Math.abs(a.index - b.index);
  return gap === 1 || (a.closed && gap === a.count - 1);
}

/** Intersection snap points among objects on layers that are neither frozen nor off, plus the (already visible) xref objects. */
export function intersectionPoints(model: DrawingModel, xrefObjects: StoredObject[]): Point[] {
  const visible = new Set(model.layers.filter((l) => l.on && !l.frozen).map((l) => l.name));
  const entries: Entry[] = [];
  let owners = 0;
  const add = (object: StoredObject): void => {
    const curves = curvesOf(object);
    const closed = object.type === 'polyline' && object.closed;
    const owner = owners++;
    curves.forEach((curve, i) => entries.push(entryOf(curve, owner, i, curves.length, closed)));
  };
  for (const object of model.objects) if (visible.has(object.layer)) add(object);
  for (const object of xrefObjects) add(object);
  entries.sort((a, b) => a.minX - b.minX);

  const seen = new Set<string>();
  const points: Point[] = [];
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i] as Entry;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j] as Entry;
      if (b.minX > a.maxX) break;
      if (b.minY > a.maxY || b.maxY < a.minY || adjacent(a, b)) continue;
      for (const p of intersectCurves(a.curve, b.curve)) {
        const rounded: Point = [round6(p[0]), round6(p[1])];
        const key = `${rounded[0]},${rounded[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(rounded);
      }
    }
  }
  return points;
}

/** Where the infinite lines a1-b1 and a2-b2 cross; null when they are parallel. */
export function crossLines(a1: Point, b1: Point, a2: Point, b2: Point): Point | null {
  const d1 = unit(a1, b1);
  const e = [b2[0] - a2[0], b2[1] - a2[1]];
  const length = Math.hypot(e[0] as number, e[1] as number);
  const cross = d1[0] * (e[1] as number) - d1[1] * (e[0] as number);
  if (length < 1e-12 || Math.abs(cross) < 1e-9 * length) return null;
  const t = ((a2[0] - a1[0]) * (e[1] as number) - (a2[1] - a1[1]) * (e[0] as number)) / cross;
  return [a1[0] + t * d1[0], a1[1] + t * d1[1]];
}
