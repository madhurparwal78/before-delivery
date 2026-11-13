import type { ObjectType, Point } from '../shared/api';
import {
  add,
  angleOf,
  arcSweep,
  closestOnSegment,
  cross,
  curveIntersections,
  distance,
  dot,
  norm,
  polar,
  polylineCurves,
  polylineParameter,
  polylineSlice,
  scaled,
  segmentParameter,
  sub,
  wrap360,
  type Curve,
} from './geometry';
import {
  asArc,
  asCircle,
  asLine,
  asPolyline,
  objectCurves,
  polylineLengthOf,
  type ObjectGeometry,
  type StoredObject,
} from './model';

const PARAM_EPS = 1e-6;

function leftOf(a: Point, b: Point, point: Point): number {
  return Math.sign(cross(sub(b, a), sub(point, a)));
}

function unitNormal(a: Point, b: Point, handedness: number): Point {
  const direction = sub(b, a);
  const length = norm(direction);
  const unit: Point = [direction[0] / length, direction[1] / length];
  return handedness >= 0 ? [-unit[1], unit[0]] : [unit[1], -unit[0]];
}

/** OFFSET: a copy of the object at the given distance, on the side of the side point. */
export function offsetGeometry(
  object: StoredObject,
  offsetDistance: number,
  side: Point,
): ObjectGeometry | null {
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      const handedness = leftOf(line.start, line.end, side);
      const normal = unitNormal(line.start, line.end, handedness === 0 ? 1 : handedness);
      const shift = scaled(normal, offsetDistance);
      return { start: add(line.start, shift), end: add(line.end, shift) };
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      const curves = polylineCurves(polyline.vertices, polyline.closed);
      let nearest = { index: 0, gap: Infinity };
      curves.forEach((curve, index) => {
        if (curve.kind !== 'segment') return;
        const gap = distance(side, closestOnSegment(side, curve.a, curve.b).point);
        if (gap < nearest.gap) nearest = { index, gap };
      });
      const reference = curves[nearest.index];
      if (reference === undefined || reference.kind !== 'segment') return null;
      const handedness = leftOf(reference.a, reference.b, side) || 1;
      const shifted = curves
        .filter((curve): curve is { kind: 'segment'; a: Point; b: Point } => curve.kind === 'segment')
        .map((curve) => {
          const shift = scaled(unitNormal(curve.a, curve.b, handedness), offsetDistance);
          return { a: add(curve.a, shift), b: add(curve.b, shift) };
        });
      const vertices: Point[] = [];
      const joinCount = polyline.closed ? shifted.length : shifted.length - 1;
      if (!polyline.closed) vertices.push(shifted[0]!.a);
      for (let i = 0; i < joinCount; i += 1) {
        const current = shifted[i]!;
        const next = shifted[(i + 1) % shifted.length]!;
        const joint = infiniteIntersection(current.a, current.b, next.a, next.b);
        vertices.push(joint ?? current.b);
      }
      if (!polyline.closed) vertices.push(shifted.at(-1)!.b);
      if (polyline.closed) vertices.unshift(vertices.pop()!);
      return { vertices, closed: polyline.closed };
    }
    case 'circle': {
      const circle = asCircle(object);
      const outward = distance(circle.center, side) > circle.radius;
      const radius = outward ? circle.radius + offsetDistance : circle.radius - offsetDistance;
      if (radius <= PARAM_EPS) return null;
      return { center: circle.center, radius };
    }
    case 'arc': {
      const arc = asArc(object);
      const outward = distance(arc.center, side) > arc.radius;
      const radius = outward ? arc.radius + offsetDistance : arc.radius - offsetDistance;
      if (radius <= PARAM_EPS) return null;
      return { ...arc, radius };
    }
    default:
      return null;
  }
}

export function infiniteIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return null;
  const t = cross(sub(c, a), s) / denominator;
  return add(a, scaled(r, t));
}

// ---------------------------------------------------------------------------
// TRIM
// ---------------------------------------------------------------------------

export type TrimOutcome =
  | { kind: 'no_edge' }
  | { kind: 'erase' }
  | { kind: 'modify'; type: ObjectType; data: ObjectGeometry }
  | { kind: 'split'; type: ObjectType; keep: ObjectGeometry; extra: ObjectGeometry };

interface Span {
  from: number;
  to: number;
}

/** Which part of a parametrised path TRIM keeps, given the cut parameters and the pick. */
function keptSpans(parameters: number[], total: number, pick: number, closed: boolean): Span[] | null {
  const tolerance = PARAM_EPS * Math.max(1, total);
  const cuts: number[] = [];
  for (const value of [...parameters].sort((a, b) => a - b)) {
    if (value < -tolerance || value > total + tolerance) continue;
    const clamped = Math.min(total, Math.max(0, value));
    if (cuts.length === 0 || Math.abs(cuts[cuts.length - 1]! - clamped) > tolerance) cuts.push(clamped);
  }
  if (cuts.length === 0) return null;
  if (closed) {
    if (cuts.length < 2) return [];
    for (let i = 0; i < cuts.length; i += 1) {
      const lower = cuts[i]!;
      const removeTo = i + 1 === cuts.length ? cuts[0]! + total : cuts[i + 1]!;
      const inside = (value: number): boolean => value > lower + tolerance && value < removeTo - tolerance;
      if (!inside(pick) && !inside(pick + total)) continue;
      const keepFrom = removeTo % total;
      return [{ from: keepFrom, to: keepFrom + (lower + total - removeTo) }];
    }
    return [];
  }
  let lower: number | null = null;
  let upper: number | null = null;
  for (const cut of cuts) {
    if (cut < pick - tolerance) lower = cut;
    if (cut > pick + tolerance && upper === null) upper = cut;
  }
  const spans: Span[] = [];
  if (lower !== null && lower > tolerance) spans.push({ from: 0, to: lower });
  if (upper !== null && upper < total - tolerance) spans.push({ from: upper, to: total });
  return spans;
}

function cutParameters(target: StoredObject, edges: StoredObject[]): Point[] {
  const own = objectCurves(target);
  const points: Point[] = [];
  for (const edge of edges) {
    if (edge.handle === target.handle) continue;
    for (const mine of own) {
      for (const theirs of objectCurves(edge)) {
        points.push(...curveIntersections(mine, theirs));
      }
    }
  }
  return points;
}

export function trimObject(target: StoredObject, pick: Point, edges: StoredObject[]): TrimOutcome {
  const points = cutParameters(target, edges);
  switch (target.type) {
    case 'line': {
      const line = asLine(target);
      const parameters = points.map((point) => segmentParameter(line.start, line.end, point));
      const spans = keptSpans(parameters, 1, segmentParameter(line.start, line.end, pick), false);
      if (spans === null) return { kind: 'no_edge' };
      const pieces = spans.map((span) => ({
        start: pointOnLine(line.start, line.end, span.from),
        end: pointOnLine(line.start, line.end, span.to),
      }));
      if (pieces.length === 0) return { kind: 'erase' };
      if (pieces.length === 1) return { kind: 'modify', type: 'line', data: pieces[0]! };
      return { kind: 'split', type: 'line', keep: pieces[0]!, extra: pieces[1]! };
    }
    case 'polyline': {
      const polyline = asPolyline(target);
      const total = polylineLengthOf(polyline);
      const parameters = points.map((point) => polylineParameter(polyline.vertices, polyline.closed, point));
      const pickParameter = polylineParameter(polyline.vertices, polyline.closed, pick);
      const spans = keptSpans(parameters, total, pickParameter, polyline.closed);
      if (spans === null) return { kind: 'no_edge' };
      const pieces = spans.map((span) => ({
        vertices: cyclicSlice(polyline.vertices, polyline.closed, span.from, span.to, total),
        closed: false,
      }));
      if (pieces.length === 0) return { kind: 'erase' };
      if (pieces.length === 1) return { kind: 'modify', type: 'polyline', data: pieces[0]! };
      return { kind: 'split', type: 'polyline', keep: pieces[0]!, extra: pieces[1]! };
    }
    case 'circle': {
      const circle = asCircle(target);
      const parameters = points.map((point) => wrap360(angleOf(sub(point, circle.center))));
      const spans = keptSpans(parameters, 360, wrap360(angleOf(sub(pick, circle.center))), true);
      if (spans === null) return { kind: 'no_edge' };
      const span = spans[0];
      if (span === undefined) return { kind: 'erase' };
      return {
        kind: 'modify',
        type: 'arc',
        data: {
          center: circle.center,
          radius: circle.radius,
          start_angle: wrap360(span.from),
          end_angle: wrap360(span.to),
        },
      };
    }
    case 'arc': {
      const arc = asArc(target);
      const sweep = arcSweep(arc.start_angle, arc.end_angle);
      const parameters = points.map((point) => wrap360(angleOf(sub(point, arc.center)) - arc.start_angle));
      const pickParameter = wrap360(angleOf(sub(pick, arc.center)) - arc.start_angle);
      const spans = keptSpans(parameters, sweep, pickParameter, false);
      if (spans === null) return { kind: 'no_edge' };
      const pieces = spans.map((span) => ({
        center: arc.center,
        radius: arc.radius,
        start_angle: wrap360(arc.start_angle + span.from),
        end_angle: wrap360(arc.start_angle + span.to),
      }));
      if (pieces.length === 0) return { kind: 'erase' };
      if (pieces.length === 1) return { kind: 'modify', type: 'arc', data: pieces[0]! };
      return { kind: 'split', type: 'arc', keep: pieces[0]!, extra: pieces[1]! };
    }
    default:
      return { kind: 'no_edge' };
  }
}

function pointOnLine(start: Point, end: Point, parameter: number): Point {
  return add(start, scaled(sub(end, start), parameter));
}

function cyclicSlice(vertices: Point[], closed: boolean, from: number, to: number, total: number): Point[] {
  if (to <= total + PARAM_EPS) return polylineSlice(vertices, closed, from, Math.min(to, total));
  const head = polylineSlice(vertices, closed, from, total);
  const tail = polylineSlice(vertices, closed, 0, to - total);
  return [...head, ...tail.slice(1)];
}

// ---------------------------------------------------------------------------
// EXTEND
// ---------------------------------------------------------------------------

export type ExtendOutcome = { kind: 'no_edge' } | { kind: 'modify'; data: ObjectGeometry };

export function extendObject(target: StoredObject, pick: Point, edges: StoredObject[]): ExtendOutcome {
  const others = edges.filter((edge) => edge.handle !== target.handle).flatMap(objectCurves);
  if (target.type === 'line') {
    const line = asLine(target);
    const atEnd = distance(pick, line.end) <= distance(pick, line.start);
    const anchor = atEnd ? line.start : line.end;
    const moving = atEnd ? line.end : line.start;
    const direction = sub(moving, anchor);
    const length = norm(direction);
    if (length < PARAM_EPS) return { kind: 'no_edge' };
    const ray: Curve = { kind: 'segment', a: anchor, b: add(anchor, scaled(direction, 1e6 / length)) };
    let best: { point: Point; reach: number } | null = null;
    for (const curve of others) {
      for (const hit of curveIntersections(ray, curve)) {
        const reach = dot(sub(hit, anchor), direction) / length;
        if (reach <= length + PARAM_EPS) continue;
        if (best === null || reach < best.reach) best = { point: hit, reach };
      }
    }
    if (best === null) return { kind: 'no_edge' };
    return { kind: 'modify', data: atEnd ? { start: line.start, end: best.point } : { start: best.point, end: line.end } };
  }
  if (target.type === 'arc') {
    const arc = asArc(target);
    const sweep = arcSweep(arc.start_angle, arc.end_angle);
    const full: Curve = { kind: 'arc', c: arc.center, r: arc.radius, start: 0, sweep: 360 };
    const hits: number[] = [];
    for (const curve of others) {
      for (const hit of curveIntersections(full, curve)) {
        hits.push(wrap360(angleOf(sub(hit, arc.center)) - arc.start_angle));
      }
    }
    const atEnd =
      distance(pick, polar(arc.center, arc.radius, arc.start_angle + sweep)) <=
      distance(pick, polar(arc.center, arc.radius, arc.start_angle));
    const candidates = hits.filter((value) => (atEnd ? value > sweep + PARAM_EPS : value < 360 - PARAM_EPS && value > sweep + PARAM_EPS));
    if (candidates.length === 0) return { kind: 'no_edge' };
    if (atEnd) {
      const reach = Math.min(...candidates);
      return {
        kind: 'modify',
        data: { ...arc, start_angle: wrap360(arc.start_angle), end_angle: wrap360(arc.start_angle + reach) },
      };
    }
    const reach = Math.max(...candidates);
    return {
      kind: 'modify',
      data: {
        ...arc,
        start_angle: wrap360(arc.start_angle + reach),
        end_angle: wrap360(arc.start_angle + 360),
      },
    };
  }
  return { kind: 'no_edge' };
}

// ---------------------------------------------------------------------------
// FILLET
// ---------------------------------------------------------------------------

export interface FilletResult {
  first: ObjectGeometry;
  second: ObjectGeometry;
  arc: ObjectGeometry | null;
}

export function filletLines(first: StoredObject, second: StoredObject, radius: number): FilletResult | null {
  if (first.type !== 'line' || second.type !== 'line') return null;
  const a = asLine(first);
  const b = asLine(second);
  const apex = infiniteIntersection(a.start, a.end, b.start, b.end);
  if (apex === null) return null;

  const outward = (line: { start: Point; end: Point }): { near: 'start' | 'end'; unit: Point } => {
    const near = distance(apex, line.start) <= distance(apex, line.end) ? 'start' : 'end';
    const far = near === 'start' ? line.end : line.start;
    const direction = sub(far, apex);
    const length = norm(direction);
    return { near, unit: [direction[0] / length, direction[1] / length] };
  };

  const firstRay = outward(a);
  const secondRay = outward(b);

  if (radius === 0) {
    return {
      first: firstRay.near === 'start' ? { start: apex, end: a.end } : { start: a.start, end: apex },
      second: secondRay.near === 'start' ? { start: apex, end: b.end } : { start: b.start, end: apex },
      arc: null,
    };
  }

  const cosine = Math.max(-1, Math.min(1, dot(firstRay.unit, secondRay.unit)));
  const theta = Math.acos(cosine);
  if (theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) return null;
  const tangentDistance = radius / Math.tan(theta / 2);
  const firstTangent = add(apex, scaled(firstRay.unit, tangentDistance));
  const secondTangent = add(apex, scaled(secondRay.unit, tangentDistance));
  const bisector = add(firstRay.unit, secondRay.unit);
  const bisectorLength = norm(bisector);
  if (bisectorLength < 1e-9) return null;
  const centre = add(apex, scaled(bisector, radius / Math.sin(theta / 2) / bisectorLength));
  const firstAngle = angleOf(sub(firstTangent, centre));
  const secondAngle = angleOf(sub(secondTangent, centre));
  const forward = wrap360(secondAngle - firstAngle) <= 180;
  return {
    first: firstRay.near === 'start' ? { start: firstTangent, end: a.end } : { start: a.start, end: firstTangent },
    second:
      secondRay.near === 'start' ? { start: secondTangent, end: b.end } : { start: b.start, end: secondTangent },
    arc: {
      center: centre,
      radius,
      start_angle: forward ? firstAngle : secondAngle,
      end_angle: forward ? secondAngle : firstAngle,
    },
  };
}
