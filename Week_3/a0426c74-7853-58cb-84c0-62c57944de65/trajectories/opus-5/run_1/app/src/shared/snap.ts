import { round6 } from './numbers.js';
import type { DrawingModel, Entity } from './model.js';
import { handleNumber } from './model.js';
import {
  type Vec,
  add,
  angleOf,
  closestOnEntity,
  dist,
  entityIntersections,
  entityPoints,
  entityPrims,
  mul,
  norm,
  perpFoot,
  sub,
  tangentPoints,
  toRad,
  vec,
} from './geometry.js';

export type SnapKind = 'endpoint' | 'midpoint' | 'centre' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest';

export const SNAP_PRIORITY: SnapKind[] = [
  'endpoint',
  'midpoint',
  'centre',
  'intersection',
  'perpendicular',
  'tangent',
  'nearest',
];

export const APERTURE_PX = 10;

export interface SnapCandidate {
  kind: SnapKind;
  point: Vec;
  handle: string;
}

export interface Aids {
  snap: boolean;
  ortho: boolean;
  grid: boolean;
  polar: boolean;
}

export interface SnapResult {
  kind: SnapKind | 'none';
  point: Vec;
}

function candidateHandleNumber(handle: string): number {
  const bare = handle.includes('|') ? handle.slice(handle.indexOf('|') + 1) : handle;
  return handleNumber(bare);
}

export function snapCandidates(entities: Entity[], pointer: Vec, lastPoint: Vec, radius: number): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  for (const entity of entities) {
    for (const point of entityPoints(entity)) {
      if (dist(point.point, pointer) <= radius) candidates.push({ kind: point.kind, point: point.point, handle: entity.handle });
    }
  }
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      for (const point of entityIntersections(entities[i], entities[j])) {
        if (dist(point, pointer) <= radius) {
          const handle =
            candidateHandleNumber(entities[i].handle) <= candidateHandleNumber(entities[j].handle)
              ? entities[i].handle
              : entities[j].handle;
          candidates.push({ kind: 'intersection', point, handle });
        }
      }
    }
  }
  for (const entity of entities) {
    for (const prim of entityPrims(entity)) {
      if (prim.kind !== 'seg') continue;
      const foot = perpFoot(prim.a, prim.b, lastPoint);
      if (foot && dist(foot, pointer) <= radius) candidates.push({ kind: 'perpendicular', point: foot, handle: entity.handle });
    }
    if (entity.type === 'circle' || entity.type === 'arc') {
      const points = tangentPoints(vec(entity.cx, entity.cy), entity.r, lastPoint);
      if (points.length === 2) {
        const nearer = dist(points[0], pointer) <= dist(points[1], pointer) ? points[0] : points[1];
        if (dist(nearer, pointer) <= radius) candidates.push({ kind: 'tangent', point: nearer, handle: entity.handle });
      }
    }
  }
  for (const entity of entities) {
    const closest = closestOnEntity(entity, pointer);
    if (closest && dist(closest, pointer) <= radius) candidates.push({ kind: 'nearest', point: closest, handle: entity.handle });
  }
  return candidates;
}

/** Of the candidates inside the aperture, the highest priority, then the nearest, then the lowest handle. */
export function bestCandidate(candidates: SnapCandidate[], pointer: Vec): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    const byPriority = SNAP_PRIORITY.indexOf(candidate.kind) - SNAP_PRIORITY.indexOf(best.kind);
    if (byPriority < 0) {
      best = candidate;
      continue;
    }
    if (byPriority > 0) continue;
    const byDistance = dist(candidate.point, pointer) - dist(best.point, pointer);
    if (byDistance < -1e-9) {
      best = candidate;
      continue;
    }
    if (byDistance > 1e-9) continue;
    if (candidateHandleNumber(candidate.handle) < candidateHandleNumber(best.handle)) best = candidate;
  }
  return best;
}

export function applyOrtho(lastPoint: Vec, pointer: Vec): Vec {
  const dx = pointer.x - lastPoint.x;
  const dy = pointer.y - lastPoint.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? vec(lastPoint.x + dx, lastPoint.y)
    : vec(lastPoint.x, lastPoint.y + dy);
}

function nearestPolarMultiple(angle: number): { multiple: number; offset: number } {
  let best = 0;
  let bestOffset = 360;
  for (let multiple = 0; multiple < 360; multiple += 45) {
    const offset = Math.abs(((angle - multiple + 540) % 360) - 180);
    const away = 180 - offset;
    if (away < bestOffset) {
      bestOffset = away;
      best = multiple;
    }
  }
  return { multiple: best, offset: bestOffset };
}

/** Pointer points resolve through snaps, then Ortho or Polar, then Grid. */
export function resolvePointerPoint(
  entities: Entity[],
  pointer: Vec,
  lastPoint: Vec,
  aids: Aids,
  zoom: number,
): SnapResult {
  if (aids.snap) {
    const radius = APERTURE_PX / zoom;
    const candidate = bestCandidate(snapCandidates(entities, pointer, lastPoint, radius), pointer);
    if (candidate) {
      return { kind: candidate.kind, point: vec(round6(candidate.point.x), round6(candidate.point.y)) };
    }
  }

  let shaped: 'none' | 'axis' | 'diagonal' = 'none';
  let point = pointer;
  if (aids.ortho) {
    point = applyOrtho(lastPoint, pointer);
    shaped = 'axis';
  } else if (aids.polar) {
    const angle = angleOf(sub(pointer, lastPoint));
    const { multiple, offset } = nearestPolarMultiple(angle);
    if (offset <= 5) {
      const distance = dist(pointer, lastPoint);
      point = add(lastPoint, mul(vec(Math.cos(toRad(multiple)), Math.sin(toRad(multiple))), distance));
      shaped = multiple % 90 === 0 ? 'axis' : 'diagonal';
    }
  }

  if (aids.grid) {
    if (shaped === 'none') {
      point = vec(Math.round(point.x), Math.round(point.y));
    } else if (shaped === 'axis') {
      const movedX = Math.abs(point.x - lastPoint.x) > 1e-9;
      point = movedX ? vec(Math.round(point.x), lastPoint.y) : vec(lastPoint.x, Math.round(point.y));
    } else {
      const direction = norm(sub(point, lastPoint));
      const distance = Math.round(dist(point, lastPoint));
      point = add(lastPoint, mul(direction, distance));
    }
  }

  return { kind: 'none', point: vec(round6(point.x), round6(point.y)) };
}

export function snapTargets(model: DrawingModel, extra: Entity[]): Entity[] {
  const out: Entity[] = [];
  for (const entity of model.entities) {
    const layer = model.layers.find((candidate) => candidate.name === entity.layer);
    if (layer && (!layer.on || layer.frozen)) continue;
    out.push(entity);
  }
  return [...out, ...extra];
}
