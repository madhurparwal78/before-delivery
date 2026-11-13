// Moving, rotating, scaling and mirroring an object: one rigid or similarity map applied to every geometry type.
import { directionOf, mod360, normalizeObject } from '../../shared/geometry.ts';
import type { Point, StoredObject } from '../../shared/types.ts';

const RAD = Math.PI / 180;

interface Transform {
  point: (p: Point) => Point;
  /** Maps a direction in degrees. */
  direction: (degrees: number) => number;
  /** Factor applied to lengths. */
  factor: number;
  /** Reverses the turning sense, so an arc swaps its ends. */
  mirrored: boolean;
}

export const translation = (from: Point, to: Point): Transform => ({
  point: (p) => [p[0] + to[0] - from[0], p[1] + to[1] - from[1]],
  direction: (d) => d, factor: 1, mirrored: false,
});

export const rotation = (base: Point, degrees: number): Transform => {
  const c = Math.cos(degrees * RAD);
  const s = Math.sin(degrees * RAD);
  return {
    point: (p) => [base[0] + (p[0] - base[0]) * c - (p[1] - base[1]) * s, base[1] + (p[0] - base[0]) * s + (p[1] - base[1]) * c],
    direction: (d) => d + degrees, factor: 1, mirrored: false,
  };
};

export const scaling = (base: Point, factor: number): Transform => ({
  point: (p) => [base[0] + (p[0] - base[0]) * factor, base[1] + (p[1] - base[1]) * factor],
  direction: (d) => d, factor, mirrored: false,
});

export const mirroring = (first: Point, second: Point): Transform => {
  const axis = directionOf(first, second);
  const c = Math.cos(2 * axis * RAD);
  const s = Math.sin(2 * axis * RAD);
  return {
    point: (p) => [first[0] + (p[0] - first[0]) * c + (p[1] - first[1]) * s, first[1] + (p[0] - first[0]) * s - (p[1] - first[1]) * c],
    direction: (d) => 2 * axis - d, factor: 1, mirrored: true,
  };
};

/** The object after the map. Text and block images stay upright and unmirrored; their anchors and sizes follow. */
export function transformObject(object: StoredObject, t: Transform): StoredObject {
  switch (object.type) {
    case 'line': return normalizeObject({ ...object, start: t.point(object.start), end: t.point(object.end) });
    case 'polyline': return normalizeObject({ ...object, vertices: object.vertices.map(t.point) });
    case 'circle': return normalizeObject({ ...object, center: t.point(object.center), radius: object.radius * t.factor });
    case 'arc': {
      const start = t.direction(object.start_angle);
      const end = t.direction(object.end_angle);
      return normalizeObject({
        ...object, center: t.point(object.center), radius: object.radius * t.factor,
        start_angle: mod360(t.mirrored ? end : start), end_angle: mod360(t.mirrored ? start : end),
      });
    }
    case 'spline': return normalizeObject({ ...object, fit_points: object.fit_points.map(t.point) });
    case 'mtext':
      return normalizeObject({
        ...object, position: t.point(object.position), width: object.width * t.factor, height: object.height * t.factor,
      });
    case 'dimension': return normalizeObject({ ...object, points: object.points.map(t.point), location: t.point(object.location) });
    case 'insert':
      return normalizeObject({
        ...object, position: t.point(object.position), scale: object.scale * t.factor, rotation: mod360(t.direction(object.rotation)),
      });
    case 'revcloud': return normalizeObject({ ...object, first: t.point(object.first), opposite: t.point(object.opposite) });
  }
}
