// Lengths, areas, the entity list row label and the Properties values.
import * as copy from '../copy.ts';
import type { Entity, Point, Xref } from '../types.ts';
import { arcSweep, cross } from './curves.ts';
import { dimensionDataValue, dimensionStyle } from './dimension.ts';
import { RAD, distance, fmt3, fmtAngle, measureDistance } from './numbers.ts';
import type { Scene, SceneEntity } from './scene.ts';

function polylineLength(points: readonly [number, number][], closed: boolean): number {
  const ring = closed ? [...points, ...points.slice(0, 1)] : points;
  return ring.slice(1).reduce((sum, p, i) => sum + distance(ring[i], p), 0);
}

/** Length of a line, arc or polyline (closing segment included); null for other types. */
export function lengthOf(entity: Entity): number | null {
  switch (entity.type) {
    case 'line':
      return distance([entity.x1, entity.y1], [entity.x2, entity.y2]);
    case 'arc':
      return entity.r * arcSweep(entity.start, entity.end) * RAD;
    case 'pline':
      return polylineLength(entity.points, entity.closed);
    default:
      return null;
  }
}

/** Area of a circle, closed polyline (shoelace) or hatch (stored area); null for other types. */
export function areaOf(entity: Entity): number | null {
  switch (entity.type) {
    case 'circle':
      return Math.PI * entity.r * entity.r;
    case 'pline': {
      if (!entity.closed) return null;
      const twice = entity.points.reduce((sum, p, i) => sum + cross(p, entity.points[(i + 1) % entity.points.length]), 0);
      return Math.abs(twice) / 2;
    }
    case 'hatch':
      return entity.area;
    default:
      return null;
  }
}

/** The DIST result sentence for the two points: the distance and the direction angle from `a` to `b`. */
export function distReport(a: Point, b: Point): string {
  const { distance: length, angle } = measureDistance(a, b);
  return copy.distResult(fmt3(length), fmtAngle(angle));
}

/** The Xrefs panel row of an attached xref: where it sits, and the clip rectangle when it has one. `sourceName` is the source drawing's name. */
export function xrefRow(xref: Xref, sourceName: string): { placement: string; clip: string | null } {
  return {
    placement: copy.xrefPlacement(sourceName, fmt3(xref.x), fmt3(xref.y), fmt3(xref.scale), fmt3(xref.rotation)),
    clip: xref.clip === null ? null : copy.xrefClip(xref.clip.map(fmt3).join(',')),
  };
}

const pair = (x: number, y: number): string => `${fmt3(x)},${fmt3(y)}`;

/** The entity list row label (brief: Entity list); the dimension value uses its style's precision. */
export function entityLabel(scene: Scene, scened: SceneEntity): string {
  const e = scened.entity;
  const length = fmt3(lengthOf(e) ?? 0);
  switch (e.type) {
    case 'line':
      return copy.rowLine(e.handle, e.layer, pair(e.x1, e.y1), pair(e.x2, e.y2), length);
    case 'circle':
      return copy.rowCircle(e.handle, e.layer, pair(e.cx, e.cy), fmt3(e.r), fmt3(areaOf(e) ?? 0));
    case 'arc':
      return copy.rowArc(e.handle, e.layer, pair(e.cx, e.cy), fmt3(e.r), fmt3(e.start), fmt3(e.end), length);
    case 'pline':
      return copy.rowPolyline(e.handle, e.layer, e.points.length, length, e.closed ? fmt3(areaOf(e) ?? 0) : null);
    case 'hatch':
      return copy.rowHatch(e.handle, e.layer, fmt3(e.area));
    case 'dimension':
      return copy.rowDimension(e.handle, e.layer, e.kind, dimensionDataValue(e, dimensionStyle(scene.dimStyles, e.style)));
    case 'insert':
      return copy.rowInsert(e.handle, e.layer, e.block, pair(e.x, e.y), fmt3(e.scale), fmt3(e.rotation));
  }
}

export type MeasureProperty = 'length' | 'area';

/** Properties region: the display text of Length or Area for the selected entities, `*VARIES*` when they differ, null when none has one. */
export function propertyText(entities: readonly Entity[], property: MeasureProperty): string | null {
  const measure = property === 'length' ? lengthOf : areaOf;
  const texts = entities.map((e) => {
    const value = measure(e);
    return value === null ? null : fmt3(value);
  });
  const first = texts[0];
  if (first === undefined || texts.every((text) => text === null)) return null;
  return texts.every((text) => text === first) ? first : copy.VARIES;
}
