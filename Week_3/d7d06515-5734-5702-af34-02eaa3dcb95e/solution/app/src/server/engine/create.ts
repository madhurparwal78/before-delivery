// Geometry of the commands that create objects. Pure: base commands and trace markups both build their objects here.
import { BLOCK_NAMES } from '../../shared/types.ts';
import { directionOf, distance, mod360, polar } from '../../shared/geometry.ts';
import type { Geometry, Point, StoredObject } from '../../shared/types.ts';
import { crossLines } from './intersect.ts';
import { invalid, MESSAGE, type Reader } from './validate.ts';

const MAX_SIDES = 1000;

export function lineGeometries(r: Reader): Geometry[] {
  const points = r.points('points', 2);
  const close = r.flag('close', false);
  if (close && points.length < 3) invalid('close', MESSAGE.invalidValue);
  const ring = close ? [...points, points[0] as Point] : points;
  const lines: Geometry[] = [];
  for (let i = 0; i + 1 < ring.length; i++) lines.push({ type: 'line', start: ring[i] as Point, end: ring[i + 1] as Point });
  return lines;
}

export function polylineGeometry(r: Reader): Geometry {
  const vertices = r.points('points', 2);
  const closed = r.flag('closed', false);
  if (closed && vertices.length < 3) invalid('closed', MESSAGE.invalidValue);
  return { type: 'polyline', vertices, closed };
}

/** Four vertices starting at `first`, counter-clockwise. */
export function rectangleGeometry(r: Reader): Geometry {
  const first = r.point('first');
  const other = r.point('other');
  if (first[0] === other[0] || first[1] === other[1]) invalid('other', MESSAGE.zeroSize);
  const corners: Point[] = [first, [other[0], first[1]], other, [first[0], other[1]]];
  const clockwise = (other[0] - first[0]) * (other[1] - first[1]) < 0;
  return { type: 'polyline', vertices: clockwise ? [first, corners[3] as Point, other, corners[1] as Point] : corners, closed: true };
}

export function circleGeometry(r: Reader): Geometry {
  return { type: 'circle', center: r.point('center'), radius: r.positive('radius') };
}

export function arcGeometry(r: Reader): Geometry {
  return {
    type: 'arc', center: r.point('center'), radius: r.positive('radius'),
    start_angle: mod360(r.finite('start_angle')), end_angle: mod360(r.finite('end_angle')),
  };
}

/** Inscribed in the circle of `radius`, first vertex on +X. */
export function polygonGeometry(r: Reader): Geometry {
  const sides = r.positive('sides');
  if (!Number.isInteger(sides) || sides < 3) invalid('sides', MESSAGE.sidesMinimum);
  if (sides > MAX_SIDES) invalid('sides', MESSAGE.invalidValue);
  const center = r.point('center');
  const radius = r.positive('radius');
  const vertices: Point[] = [];
  for (let i = 0; i < sides; i++) vertices.push(polar(center, radius, (360 * i) / sides));
  return { type: 'polyline', vertices, closed: true };
}

export function splineGeometry(r: Reader): Geometry {
  return { type: 'spline', fit_points: r.points('fit_points', 2) };
}

export function mtextGeometry(r: Reader): Geometry {
  const position = r.point('position');
  const width = r.positive('width');
  const height = r.positive('height');
  const contents = r.text('contents');
  if (contents.trim() === '') invalid('contents', MESSAGE.contentsRequired);
  return { type: 'mtext', position, width, height, contents };
}

export function insertGeometry(r: Reader): Geometry {
  return {
    type: 'insert', block: r.oneOf('block', BLOCK_NAMES), position: r.point('position'),
    scale: r.has('scale') ? r.positive('scale') : 1, rotation: r.has('rotation') ? mod360(r.finite('rotation')) : 0,
  };
}

export function revcloudGeometry(r: Reader): Geometry {
  const first = r.point('first');
  const opposite = r.point('opposite');
  if (first[0] === opposite[0] || first[1] === opposite[1]) invalid('opposite', MESSAGE.zeroSize);
  return { type: 'revcloud', first, opposite };
}

/** DIMLINEAR and DIMALIGNED: the origins and the location are all the dimension stores. */
export function linearDimensionGeometry(r: Reader, kind: 'linear' | 'aligned'): Geometry {
  const first = r.point('first');
  const second = r.point('second');
  const location = r.point('location');
  if (kind === 'aligned' && distance(first, second) === 0) invalid('second', MESSAGE.distinctPoints);
  return { type: 'dimension', kind, points: [first, second], location, text_override: null };
}

export function radiusDimensionGeometry(circle: StoredObject, r: Reader): Geometry {
  const location = r.point('location');
  if (circle.type !== 'circle' && circle.type !== 'arc') invalid('handle', MESSAGE.notApplicable);
  const toward = distance(circle.center, location) === 0 ? 0 : directionOf(circle.center, location);
  return { type: 'dimension', kind: 'radius', points: [circle.center, polar(circle.center, circle.radius, toward)], location, text_override: null };
}

export function angularDimensionGeometry(first: StoredObject, second: StoredObject, r: Reader): Geometry {
  const location = r.point('location');
  if (first.type !== 'line') invalid('first_handle', MESSAGE.notApplicable);
  if (second.type !== 'line') invalid('second_handle', MESSAGE.notApplicable);
  if (first.handle === second.handle) invalid('second_handle', MESSAGE.sameObject);
  const vertex = crossLines(first.start, first.end, second.start, second.end);
  if (!vertex) invalid('second_handle', MESSAGE.parallel);
  const far = (line: { start: Point; end: Point }): Point => (distance(vertex, line.start) >= distance(vertex, line.end) ? line.start : line.end);
  return { type: 'dimension', kind: 'angular', points: [vertex, far(first), far(second)], location, text_override: null };
}
