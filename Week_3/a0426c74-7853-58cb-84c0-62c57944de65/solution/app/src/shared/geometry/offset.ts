// OFFSET of a line, circle, arc or polyline, and ARRAY copies.
import * as copy from '../copy.ts';
import type { Entity, EntityDraft, Point } from '../types.ts';
import { distanceToPrim, lineCrossing } from './curves.ts';
import { type Refusal, inheriting } from './modify.ts';
import { TOL, distance, round6, roundPoint } from './numbers.ts';
import { transformEntity, withoutHandle } from './transform.ts';

const unitNormal = (a: Point, b: Point): Point => {
  const d = distance(a, b);
  return [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
};

const shift = (p: Point, normal: Point, by: number): Point => [p[0] + normal[0] * by, p[1] + normal[1] * by];

/** The side of a segment a point lies on: +1 left of a -> b, -1 right. */
function sideOf(a: Point, b: Point, p: Point): 1 | -1 {
  const normal = unitNormal(a, b);
  return (p[0] - a[0]) * normal[0] + (p[1] - a[1]) * normal[1] >= 0 ? 1 : -1;
}

const distanceToSegment = ([a, b]: [Point, Point], p: Point): number => distanceToPrim({ kind: 'segment', a, b }, p);

function offsetPolyline(points: readonly Point[], closed: boolean, d: number, pick: Point, side: Point): Point[] {
  const ring = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > TOL);
  const count = closed ? ring.length : ring.length - 1;
  const segments = Array.from({ length: count }, (_, i): [Point, Point] => [ring[i], ring[(i + 1) % ring.length]]);
  const nearest = segments.reduce((best, segment) => (distanceToSegment(segment, pick) < distanceToSegment(best, pick) ? segment : best));
  const sign = sideOf(nearest[0], nearest[1], side);
  const moved = segments.map(([a, b]): [Point, Point] => {
    const normal = unitNormal(a, b);
    return [shift(a, normal, sign * d), shift(b, normal, sign * d)];
  });
  const joined = (previous: [Point, Point], next: [Point, Point]): Point => lineCrossing(previous[0], previous[1], next[0], next[1])?.point ?? next[0];
  const vertices = moved.map((segment, i): Point => (i === 0 && !closed ? segment[0] : joined(moved[(i + moved.length - 1) % moved.length], segment)));
  return closed ? vertices : [...vertices, moved[moved.length - 1][1]];
}

/** r + d when the side point is outside the circle, r - d inside; null when that reaches zero or below. */
function offsetRadius(r: number, sideDistance: number, d: number): number | null {
  const offsetted = sideDistance >= r ? r + d : r - d;
  return offsetted <= TOL ? null : round6(offsetted);
}

/** OFFSET one entity (line, circle, arc, polyline) by `distance` towards `side`; `pick` is the pick point on the entity. */
export function offsetEntity(entity: Entity, d: number, pick: Point, side: Point): EntityDraft | Refusal {
  switch (entity.type) {
    case 'line': {
      const a: Point = [entity.x1, entity.y1];
      const b: Point = [entity.x2, entity.y2];
      const normal = unitNormal(a, b);
      const by = sideOf(a, b, side) * d;
      const [p, q] = [roundPoint(shift(a, normal, by)), roundPoint(shift(b, normal, by))];
      return inheriting(entity, { type: 'line', x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
    }
    case 'circle':
    case 'arc': {
      const { handle: _handle, ...shape } = entity;
      const r = offsetRadius(entity.r, distance([entity.cx, entity.cy], side), d);
      return r === null ? { refused: copy.OFFSET_ZERO_RADIUS } : { ...shape, r };
    }
    case 'pline':
      return inheriting(entity, { type: 'pline', points: offsetPolyline(entity.points, entity.closed, d, pick, side).map(roundPoint), closed: entity.closed });
    default:
      return { refused: copy.NOTHING_TO_PICK };
  }
}

/** ARRAY rows x columns: copies row by row, original cell first (not included): rows go up by `rowGap`, columns right by `columnGap`. */
export function rectangularArray(entity: Entity, rows: number, columns: number, rowGap: number, columnGap: number): EntityDraft[] {
  const copies: EntityDraft[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (row === 0 && column === 0) continue;
      copies.push(withoutHandle(transformEntity(entity, { kind: 'translate', dx: column * columnGap, dy: row * rowGap })));
    }
  }
  return copies;
}

/** ARRAY polar: count - 1 copies rotated (with their position) by steps of total / count when total is 360, else total / (count - 1). */
export function polarArray(entity: Entity, centre: Point, count: number, totalAngle: number): EntityDraft[] {
  const step = totalAngle === 360 ? totalAngle / count : totalAngle / (count - 1);
  return Array.from({ length: count - 1 }, (_, i) => withoutHandle(transformEntity(entity, { kind: 'rotate', about: centre, degrees: step * (i + 1) })));
}
