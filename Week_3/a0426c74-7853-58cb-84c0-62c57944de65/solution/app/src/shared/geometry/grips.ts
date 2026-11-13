// Grips of a selected entity and the edit a grip drag produces.
import type { Entity, Point } from '../types.ts';
import { arcEnds } from './curves.ts';
import { directionDeg, distance, midpoint, pointAtAngle, round6 } from './numbers.ts';

export type GripKind = 'end' | 'mid' | 'centre' | 'quadrant' | 'vertex';
/** `index`: line 0 = start, 1 = end; arc 0 = start, 1 = end; polyline vertex number; circle quadrant 0..3 (east, north, west, south). */
export interface Grip { kind: GripKind; index: number; x: number; y: number }

const grip = (kind: GripKind, index: number, p: Point): Grip => ({ kind, index, x: round6(p[0]), y: round6(p[1]) });

/** Grips of a selected entity: line end+mid, circle centre+4 quadrants, arc centre+2 ends, polyline vertices; none for other types. */
export function gripsOf(entity: Entity): Grip[] {
  switch (entity.type) {
    case 'line':
      return [
        grip('end', 0, [entity.x1, entity.y1]), grip('end', 1, [entity.x2, entity.y2]),
        grip('mid', 0, midpoint([entity.x1, entity.y1], [entity.x2, entity.y2])),
      ];
    case 'circle': {
      const centre: Point = [entity.cx, entity.cy];
      return [grip('centre', 0, centre), ...[0, 90, 180, 270].map((degrees, i) => grip('quadrant', i, pointAtAngle(centre, entity.r, degrees)))];
    }
    case 'arc': {
      const [start, end] = arcEnds({ kind: 'arc', c: [entity.cx, entity.cy], r: entity.r, start: entity.start, end: entity.end });
      return [grip('centre', 0, [entity.cx, entity.cy]), grip('end', 0, start), grip('end', 1, end)];
    }
    case 'pline':
      return entity.points.map((p, i) => grip('vertex', i, p));
    default:
      return [];
  }
}

/** The `set` of the modify operation that dragging `grip` to `to` produces (line end stretches, mid moves, quadrant sets the radius, arc end sets that angle). */
export function dragGrip(entity: Entity, dragged: Grip, to: Point): Record<string, unknown> {
  const [x, y] = [round6(to[0]), round6(to[1])];
  switch (entity.type) {
    case 'line':
      if (dragged.kind === 'mid') {
        const dx = to[0] - dragged.x;
        const dy = to[1] - dragged.y;
        return { x1: round6(entity.x1 + dx), y1: round6(entity.y1 + dy), x2: round6(entity.x2 + dx), y2: round6(entity.y2 + dy) };
      }
      return dragged.index === 0 ? { x1: x, y1: y } : { x2: x, y2: y };
    case 'circle':
      return dragged.kind === 'centre' ? { cx: x, cy: y } : { r: round6(distance([entity.cx, entity.cy], to)) };
    case 'arc':
      if (dragged.kind === 'centre') return { cx: x, cy: y };
      return { [dragged.index === 0 ? 'start' : 'end']: round6(directionDeg([entity.cx, entity.cy], to)) };
    case 'pline':
      return { points: entity.points.map((p, i): Point => (i === dragged.index ? [x, y] : p)) };
    default:
      return {};
  }
}
