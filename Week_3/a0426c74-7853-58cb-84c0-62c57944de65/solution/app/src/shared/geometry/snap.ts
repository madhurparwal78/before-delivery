// Object snaps, Ortho / Polar / Grid shaping and the pointer point they build.
import type { Point, Rect } from '../types.ts';
import { type Prim, arcEnds, arcMid, closestOnSegment, closestPoint, intersections, lineParameter, onArc, pointInRect, pointOnLine, rectsMeet, tangentPoints } from './curves.ts';
import { compareHandles, directionDeg, distance, handleNumber, normalizeAngle, RAD, roundPoint } from './numbers.ts';
import { type Scene, type SceneEntity, queryRect } from './scene.ts';
import type { View } from './view.ts';

const SNAP_KINDS = ['endpoint', 'midpoint', 'centre', 'intersection', 'perpendicular', 'tangent', 'nearest'] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];
/** `id` is the entity offering the candidate (for an intersection the one with the lower handle number). */
export interface SnapCandidate { kind: SnapKind; point: Point; id: string }

export const SNAP_APERTURE_PX = 10;
const POLAR_TOLERANCE = 5;
const POLAR_STEP = 45;

function primCandidates(prim: Prim, id: string, pointer: Point, last: Point): SnapCandidate[] {
  const found: SnapCandidate[] = [];
  const add = (kind: SnapKind, point: Point): void => { found.push({ kind, point, id }); };
  if (prim.kind === 'segment') {
    add('endpoint', prim.a);
    add('endpoint', prim.b);
    add('midpoint', pointOnLine(prim.a, prim.b, 0.5));
    const t = lineParameter(prim.a, prim.b, last);
    if (t >= 0 && t <= 1) add('perpendicular', pointOnLine(prim.a, prim.b, t));
    add('nearest', closestOnSegment(prim.a, prim.b, pointer));
    return found;
  }
  add('centre', prim.c);
  if (prim.kind === 'arc') {
    const [start, end] = arcEnds(prim);
    add('endpoint', start);
    add('endpoint', end);
    add('midpoint', arcMid(prim));
  }
  const tangents = tangentPoints(last, prim.c, prim.r).filter((p) => prim.kind === 'circle' || onArc(directionDeg(prim.c, p), prim.start, prim.end));
  const nearer = tangents.sort((a, b) => distance(a, pointer) - distance(b, pointer))[0];
  if (nearer !== undefined) add('tangent', nearer);
  add('nearest', closestPoint(prim, pointer));
  return found;
}

const snappable = (e: SceneEntity): boolean => e.entity.type !== 'dimension' && e.entity.type !== 'hatch';

function crossings(entities: readonly SceneEntity[], window: Rect): SnapCandidate[] {
  const found: SnapCandidate[] = [];
  entities.forEach((first, i) => {
    for (const second of entities.slice(i + 1)) {
      if (!rectsMeet(first.bounds, second.bounds)) continue;
      const id = compareHandles(first.id, second.id) <= 0 ? first.id : second.id;
      for (const a of first.prims) {
        for (const b of second.prims) {
          for (const point of intersections(a, b)) {
            if (pointInRect(window, point)) found.push({ kind: 'intersection', point, id });
          }
        }
      }
    }
  });
  return found;
}

/**
 * Snaps (brief: Snaps): the winning candidate within the 10 px aperture (highest priority, then smaller screen distance, then lower handle
 * number), or null. `last` is the last point entered (perpendicular and tangent are measured from it). Uses visible entities, xref ones included.
 */
export function findSnap(scene: Scene, world: Point, view: View, last: Point): SnapCandidate | null {
  const reach = SNAP_APERTURE_PX / view.zoom;
  const window: Rect = [world[0] - reach, world[1] - reach, world[0] + reach, world[1] + reach];
  const near = queryRect(scene, window).filter(snappable);
  const candidates = [
    ...near.flatMap((e) => e.prims.flatMap((prim) => primCandidates(prim, e.id, world, last))),
    ...crossings(near, window),
  ].filter((c) => distance(c.point, world) <= reach);
  const rank = (c: SnapCandidate): number => SNAP_KINDS.indexOf(c.kind);
  const best = candidates.sort((a, b) => rank(a) - rank(b) || distance(a.point, world) - distance(b.point, world) || handleNumber(a.id) - handleNumber(b.id))[0];
  return best === undefined ? null : { ...best, point: roundPoint(best.point) };
}

export interface DraftingAids { snap: boolean; ortho: boolean; grid: boolean; polar: boolean }
export interface ResolvedPointer { point: Point; snap: SnapCandidate | null }

type Shape = { kind: 'none' } | { kind: 'axis'; horizontal: boolean } | { kind: 'diagonal'; degrees: number };

/** Ortho keeps the larger delta; Polar turns a direction within 5 degrees of a multiple of 45 onto it, keeping the distance. */
function shapeFrom(world: Point, last: Point, aids: DraftingAids): { point: Point; shape: Shape } {
  const dx = world[0] - last[0];
  const dy = world[1] - last[1];
  if (aids.ortho) {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    return { point: horizontal ? [world[0], last[1]] : [last[0], world[1]], shape: { kind: 'axis', horizontal } };
  }
  if (aids.polar) {
    const length = distance(last, world);
    const angle = directionDeg(last, world);
    const turned = Math.round(angle / POLAR_STEP) * POLAR_STEP;
    if (length > 0 && Math.abs(angle - turned) <= POLAR_TOLERANCE) {
      const degrees = normalizeAngle(turned);
      if (degrees % 90 === 0) {
        const horizontal = degrees % 180 === 0;
        return { point: horizontal ? [last[0] + (degrees === 0 ? length : -length), last[1]] : [last[0], last[1] + (degrees === 90 ? length : -length)], shape: { kind: 'axis', horizontal } };
      }
      return { point: [last[0] + length * Math.cos(degrees * RAD), last[1] + length * Math.sin(degrees * RAD)], shape: { kind: 'diagonal', degrees } };
    }
  }
  return { point: world, shape: { kind: 'none' } };
}

function gridded(point: Point, last: Point, shape: Shape): Point {
  switch (shape.kind) {
    case 'none':
      return [Math.round(point[0]), Math.round(point[1])];
    case 'axis':
      return shape.horizontal ? [Math.round(point[0]), last[1]] : [last[0], Math.round(point[1])];
    case 'diagonal': {
      const length = Math.round(distance(last, point));
      return [last[0] + length * Math.cos(shape.degrees * RAD), last[1] + length * Math.sin(shape.degrees * RAD)];
    }
  }
}

/** Building a pointer point: an object snap wins outright, else Polar or Ortho from `last`, then Grid (the three grid cases). Rounded to 6 decimals. */
export function resolvePointer(scene: Scene, world: Point, view: View, aids: DraftingAids, last: Point): ResolvedPointer {
  const snap = aids.snap ? findSnap(scene, world, view, last) : null;
  if (snap !== null) return { point: roundPoint(snap.point), snap };
  const { point, shape } = shapeFrom(world, last, aids);
  return { point: roundPoint(aids.grid ? gridded(point, last, shape) : point), snap: null };
}
