// OFFSET, TRIM, EXTEND and FILLET: commands that cut, grow or join existing objects against the rest of the drawing.
import { COPY } from '../../shared/copy.ts';
import {
  arcSweep, closestOnSegment, directionOf, distance, mod360, polylineSegments, signedArea,
} from '../../shared/geometry.ts';
import type { Geometry, Point, StoredObject } from '../../shared/types.ts';
import type { Draft } from './draft.ts';
import { crossLines, curvesOf, intersectCurves, lineHits } from './intersect.ts';
import type { Curve } from './intersect.ts';
import { invalid, MESSAGE, type Reader } from './validate.ts';

const RAD = Math.PI / 180;
/** Pieces and offsets shorter than this are treated as nothing, in millimetres. */
const TINY = 1e-6;

type Line = Extract<StoredObject, { type: 'line' }>;
type Polyline = Extract<StoredObject, { type: 'polyline' }>;
type Arc = Extract<StoredObject, { type: 'arc' }>;
type Circle = Extract<StoredObject, { type: 'circle' }>;

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const unit = (a: Point, b: Point): Point => {
  const length = distance(a, b);
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Consecutive repeated vertices carry no direction; drop them (and a closing repeat). */
function cleaned(points: Point[], closed: boolean): Point[] {
  const kept = points.filter((p, i) => i === 0 || distance(p, points[i - 1] as Point) > TINY);
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (closed && kept.length > 1 && first && last && distance(first, last) <= TINY) kept.pop();
  return kept;
}

// ---- OFFSET ----

function insidePolygon(points: Point[], p: Point): boolean {
  let inside = false;
  for (const [a, b] of polylineSegments(points, true)) {
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

/** Offsets a vertex chain by `signed` (left of travel positive), mitring at the joins; null when the result folds back. */
function offsetChain(points: Point[], closed: boolean, signed: number): Point[] | null {
  const segments = polylineSegments(points, closed);
  const lines = segments.map(([a, b]) => {
    const u = unit(a, b);
    const n: Point = [-u[1] * signed, u[0] * signed];
    return { a: [a[0] + n[0], a[1] + n[1]] as Point, b: [b[0] + n[0], b[1] + n[1]] as Point, u, n };
  });
  const result: Point[] = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const before = closed ? lines[(i + lines.length - 1) % lines.length] : lines[i - 1];
    const after = closed ? lines[i % lines.length] : lines[i];
    if (!before && after) result.push(after.a);
    else if (before && !after) result.push(before.b);
    else if (before && after) {
      if (Math.abs(cross(before.u, after.u)) < 1e-9) {
        if (before.u[0] * after.u[0] + before.u[1] * after.u[1] < 0) return null;
        result.push(before.b);
      } else {
        const meet = crossLines(before.a, before.b, after.a, after.b);
        if (!meet) return null;
        result.push(meet);
      }
    }
  }
  const folded = polylineSegments(result, closed).some(([a, b], i) => {
    const original = segments[i] as [Point, Point];
    const u = sub(original[1], original[0]);
    const v = sub(b, a);
    return u[0] * v[0] + u[1] * v[1] <= 0;
  });
  if (folded || (closed && Math.sign(signedArea(result)) !== Math.sign(signedArea(points)))) return null;
  return result;
}

function offsetGeometry(source: StoredObject, offset: number, side: Point): Geometry {
  switch (source.type) {
    case 'line': {
      const u = unit(source.start, source.end);
      const n: Point = [-u[1], u[0]];
      const s = cross(u, sub(side, source.start));
      if (Math.abs(s) < TINY) invalid('side', MESSAGE.onTheObject);
      const d = Math.sign(s) * offset;
      return { type: 'line', start: [source.start[0] + n[0] * d, source.start[1] + n[1] * d], end: [source.end[0] + n[0] * d, source.end[1] + n[1] * d] };
    }
    case 'circle': case 'arc': {
      const away = distance(source.center, side);
      if (Math.abs(away - source.radius) < TINY) invalid('side', MESSAGE.onTheObject);
      const radius = away < source.radius ? source.radius - offset : source.radius + offset;
      if (radius <= TINY) invalid('distance', MESSAGE.distanceTooLarge);
      return { ...source, radius };
    }
    case 'polyline': return offsetPolyline(source, offset, side);
    default: return invalid('handle', MESSAGE.notApplicable);
  }
}

function offsetPolyline(source: Polyline, offset: number, side: Point): Geometry {
  const points = cleaned(source.vertices, source.closed);
  if (points.length < 2) invalid('handle', MESSAGE.notApplicable);
  const segments = polylineSegments(points, source.closed);
  let nearest = { index: 0, gap: Infinity };
  segments.forEach(([a, b], index) => {
    const gap = distance(closestOnSegment(a, b, side).point, side);
    if (gap < nearest.gap) nearest = { index, gap };
  });
  if (nearest.gap < TINY) invalid('side', MESSAGE.onTheObject);
  let left: boolean;
  if (source.closed) {
    // For a counter-clockwise ring the left side is the inside.
    left = insidePolygon(points, side) === signedArea(points) > 0;
  } else {
    const [a, b] = segments[nearest.index] as [Point, Point];
    left = cross(sub(b, a), sub(side, a)) > 0;
  }
  const vertices = offsetChain(points, source.closed, left ? offset : -offset);
  if (!vertices) invalid('distance', MESSAGE.distanceTooLarge);
  return { type: 'polyline', vertices, closed: source.closed };
}

export function offsetObject(d: Draft, r: Reader): void {
  const source = r.object('handle');
  const offset = r.positive('distance');
  const side = r.point('side');
  if (source.type !== 'line' && source.type !== 'polyline' && source.type !== 'circle' && source.type !== 'arc') {
    invalid('handle', MESSAGE.notApplicable);
  }
  if (d.unlocked([source]).length === 0) return;
  d.clone({ ...source, ...offsetGeometry(source, offset, side) });
}

// ---- TRIM and EXTEND ----

/** Every visible base object other than the one being cut is a cutting edge, locked layers included. */
function cuttingEdges(d: Draft, except: string): Curve[] {
  return d.all().filter((o) => o.handle !== except && d.isVisible(o)).flatMap(curvesOf);
}

/**
 * Which stretches of a path of `length` survive when the part between the nearest hits either side of `pick` goes.
 * `closed` paths wrap. Null means there is nothing to cut against.
 */
function keepIntervals(hits: number[], pick: number, length: number, closed: boolean, tiny: number): [number, number][] | null {
  if (hits.length === 0) return null;
  if (closed) {
    const wrapped = hits.map((h) => ((h % length) + length) % length).sort((a, b) => a - b);
    const low = wrapped[0] as number;
    if (!wrapped.some((h) => h - low > tiny && h - low < length - tiny)) return null;
    const before = wrapped.filter((h) => h <= pick);
    const after = wrapped.filter((h) => h > pick);
    const left = before.length > 0 ? Math.max(...before) : Math.max(...after) - length;
    const right = after.length > 0 ? Math.min(...after) : low + length;
    return [[right, left + length]];
  }
  const before = hits.filter((h) => h <= pick);
  const after = hits.filter((h) => h > pick);
  const from = before.length > 0 ? Math.max(...before) : 0;
  const to = after.length > 0 ? Math.min(...after) : length;
  const kept: [number, number][] = [];
  if (from > tiny) kept.push([0, from]);
  if (to < length - tiny) kept.push([to, length]);
  return kept;
}

interface Path {
  segments: [Point, Point][];
  starts: number[];
  length: number;
  closed: boolean;
}

function pathOf(points: Point[], closed: boolean): Path {
  const segments = polylineSegments(cleaned(points, closed), closed);
  const starts: number[] = [];
  let length = 0;
  for (const [a, b] of segments) {
    starts.push(length);
    length += distance(a, b);
  }
  return { segments, starts, length, closed };
}

/** The vertices of the stretch of the path between positions `from` and `to` (a closed path may run past its length). */
function sliceOf(path: Path, from: number, to: number): Point[] {
  const out: Point[] = [];
  const push = (p: Point): void => {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > TINY / 10) out.push(p);
  };
  const m = path.segments.length;
  for (let k = 0; k < (path.closed ? 2 * m : m); k++) {
    const [a, b] = path.segments[k % m] as [Point, Point];
    const start = (path.starts[k % m] as number) + path.length * Math.floor(k / m);
    const length = distance(a, b);
    if (start + length <= from || start >= to) continue;
    push(lerp(a, b, (Math.max(from, start) - start) / length));
    push(lerp(a, b, (Math.min(to, start + length) - start) / length));
  }
  return out;
}

function trimPath(d: Draft, source: Line | Polyline, pick: Point): void {
  const closed = source.type === 'polyline' && source.closed;
  const path = pathOf(source.type === 'line' ? [source.start, source.end] : source.vertices, closed);
  const edges = cuttingEdges(d, source.handle);
  const hits: number[] = [];
  path.segments.forEach(([a, b], k) => {
    for (const edge of edges) {
      for (const p of intersectCurves({ kind: 'line', a, b }, edge)) hits.push((path.starts[k] as number) + distance(a, p));
    }
  });
  let pickAt = 0;
  let nearest = Infinity;
  path.segments.forEach(([a, b], k) => {
    const { t, point } = closestOnSegment(a, b, pick);
    const gap = distance(point, pick);
    if (gap < nearest) {
      nearest = gap;
      pickAt = (path.starts[k] as number) + t * distance(a, b);
    }
  });
  const kept = keepIntervals(hits, pickAt, path.length, closed, TINY);
  if (!kept) {
    d.say(COPY.noCuttingEdge);
    return;
  }
  const pieces = kept.map(([from, to]) => sliceOf(path, from, to)).filter((piece) => piece.length >= 2);
  const shaped = (piece: Point[]): StoredObject => (source.type === 'line'
    ? { ...source, start: piece[0] as Point, end: piece[piece.length - 1] as Point }
    : { ...source, vertices: piece, closed: false });
  const [first, second] = pieces;
  if (!first) d.remove(source.handle);
  else {
    d.replace(shaped(first));
    if (second) d.clone(shaped(second));
  }
}

function trimArc(d: Draft, source: Arc | Circle, pick: Point): void {
  const isCircle = source.type === 'circle';
  const start = isCircle ? 0 : source.start_angle;
  const sweep = isCircle ? 360 : arcSweep(source.start_angle, source.end_angle);
  const tiny = TINY / (source.radius * RAD);
  const own: Curve = isCircle
    ? { kind: 'circle', center: source.center, radius: source.radius }
    : { kind: 'arc', center: source.center, radius: source.radius, start_angle: source.start_angle, end_angle: source.end_angle };
  const hits: number[] = [];
  for (const edge of cuttingEdges(d, source.handle)) {
    for (const p of intersectCurves(own, edge)) {
      const at = mod360(directionOf(source.center, p) - start);
      hits.push(at > sweep + tiny ? (at > 360 - tiny ? 0 : sweep) : at);
    }
  }
  const along = mod360(directionOf(source.center, pick) - start);
  const pickAt = along <= sweep ? along : (along - sweep < 360 - along ? sweep : 0);
  const kept = keepIntervals(hits, pickAt, sweep, isCircle, tiny);
  if (!kept) {
    d.say(COPY.noCuttingEdge);
    return;
  }
  const arcs = kept.map(([from, to]): Arc => ({
    ...source, type: 'arc', start_angle: mod360(start + from), end_angle: mod360(start + to),
  }));
  const [first, second] = arcs;
  if (!first) d.remove(source.handle);
  else {
    d.replace(first);
    if (second) d.clone(second);
  }
}

export function trimObject(d: Draft, r: Reader): void {
  const source = r.object('handle');
  const pick = r.point('pick');
  if (source.type !== 'line' && source.type !== 'polyline' && source.type !== 'circle' && source.type !== 'arc') {
    invalid('handle', MESSAGE.notApplicable);
  }
  if (d.unlocked([source]).length === 0) return;
  if (source.type === 'circle' || source.type === 'arc') trimArc(d, source, pick);
  else trimPath(d, source, pick);
}

export function extendObject(d: Draft, r: Reader): void {
  const source = r.object('handle');
  const pick = r.point('pick');
  if (source.type !== 'line') invalid('handle', MESSAGE.notApplicable);
  if (d.unlocked([source]).length === 0) return;
  const atEnd = distance(pick, source.end) <= distance(pick, source.start);
  const [from, tip] = atEnd ? [source.start, source.end] : [source.end, source.start];
  const length = distance(from, tip);
  if (length < TINY) invalid('handle', MESSAGE.notApplicable);
  const direction = unit(from, tip);
  const reach = cuttingEdges(d, source.handle)
    .flatMap((edge) => lineHits(from, direction, edge))
    .filter((t) => t > length + TINY);
  if (reach.length === 0) {
    d.say(COPY.noCuttingEdge);
    return;
  }
  const t = Math.min(...reach);
  const end: Point = [from[0] + direction[0] * t, from[1] + direction[1] * t];
  d.replace(atEnd ? { ...source, end } : { ...source, start: end });
}

// ---- FILLET ----

export function filletObjects(d: Draft, r: Reader): void {
  const listed = r.values.handles;
  if (!Array.isArray(listed) || listed.length !== 2) invalid('handles', COPY.noObjectFound);
  const radius = r.finite('radius');
  if (radius < 0) invalid('radius', COPY.positiveNumber);
  const picked = r.objects('handles');
  const [a, b] = picked;
  if (!a || !b) return invalid('handles', MESSAGE.sameObject);
  if (a.type !== 'line' || b.type !== 'line') invalid('handles', MESSAGE.notApplicable);
  const corner = crossLines(a.start, a.end, b.start, b.end);
  if (!corner) invalid('handles', MESSAGE.parallel);
  if (d.unlocked(picked).length < 2) return;

  const far = (line: Line): Point => (distance(corner, line.start) >= distance(corner, line.end) ? line.start : line.end);
  const reach = (line: Line, to: Point): Line =>
    (far(line) === line.start ? { ...line, end: to } : { ...line, start: to });
  if (radius === 0) {
    d.replace(reach(a, corner));
    d.replace(reach(b, corner));
    return;
  }
  const ua = unit(corner, far(a));
  const ub = unit(corner, far(b));
  const theta = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
  const tangent = radius / Math.tan(theta / 2);
  if (tangent > distance(corner, far(a)) + TINY || tangent > distance(corner, far(b)) + TINY) invalid('radius', MESSAGE.radiusTooLarge);
  const ta: Point = [corner[0] + ua[0] * tangent, corner[1] + ua[1] * tangent];
  const tb: Point = [corner[0] + ub[0] * tangent, corner[1] + ub[1] * tangent];
  const bisector = unit([0, 0], [ua[0] + ub[0], ua[1] + ub[1]]);
  const reachCenter = radius / Math.sin(theta / 2);
  const center: Point = [corner[0] + bisector[0] * reachCenter, corner[1] + bisector[1] * reachCenter];
  const counterClockwise = cross(sub(ta, center), sub(tb, center)) > 0;
  d.replace(reach(a, ta));
  d.replace(reach(b, tb));
  d.create({
    type: 'arc', center, radius,
    start_angle: directionOf(center, counterClockwise ? ta : tb), end_angle: directionOf(center, counterClockwise ? tb : ta),
  });
}
