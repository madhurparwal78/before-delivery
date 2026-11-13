import type { DimensionKind, DrawingObject, ObjectType, Point, SnapSet } from '../shared/api';
import { formatAngle, formatLength, type Units } from '../shared/format';
import {
  add,
  angleOf,
  arcEndpoints,
  arcLength,
  arcSweep,
  curveExtents,
  curveIntersections,
  dimensionMeasurement,
  distance,
  distanceToCurve,
  mergeExtents,
  mirrorAbout,
  placedBlockParts,
  polar,
  polygonArea,
  polylineCurves,
  polylineLength,
  revcloudArcs,
  revcloudStrokes,
  rotateAbout,
  round6,
  roundPoint,
  scaled,
  sub,
  wrap360,
  type Curve,
  type Extents,
} from './geometry';

export interface LineGeometry {
  start: Point;
  end: Point;
}
export interface PolylineGeometry {
  vertices: Point[];
  closed: boolean;
}
export interface CircleGeometry {
  center: Point;
  radius: number;
}
export interface ArcGeometry {
  center: Point;
  radius: number;
  start_angle: number;
  end_angle: number;
}
export interface SplineGeometry {
  fit_points: Point[];
}
export interface MTextGeometry {
  position: Point;
  width: number;
  height: number;
  contents: string;
}
export interface DimensionGeometry {
  kind: DimensionKind;
  points: Point[];
  location: Point;
  text_override: string | null;
  handles: string[];
}
export interface InsertGeometry {
  block: string;
  position: Point;
  scale: number;
  rotation: number;
}
export interface RevcloudGeometry {
  first: Point;
  opposite: Point;
}

export type ObjectGeometry =
  | LineGeometry
  | PolylineGeometry
  | CircleGeometry
  | ArcGeometry
  | SplineGeometry
  | MTextGeometry
  | DimensionGeometry
  | InsertGeometry
  | RevcloudGeometry;

export interface StoredObject {
  handle: string;
  type: ObjectType;
  layer: string;
  color: string;
  linetype: string;
  linetype_scale: number;
  lineweight: string;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
  data: ObjectGeometry;
  ord: number;
}

export const DEFAULT_TEXT_HEIGHT = 250;

export function asLine(object: StoredObject): LineGeometry {
  return object.data as LineGeometry;
}
export function asPolyline(object: StoredObject): PolylineGeometry {
  return object.data as PolylineGeometry;
}
export function asCircle(object: StoredObject): CircleGeometry {
  return object.data as CircleGeometry;
}
export function asArc(object: StoredObject): ArcGeometry {
  return object.data as ArcGeometry;
}
export function polylineLengthOf(polyline: PolylineGeometry): number {
  return polylineLength(polyline.vertices, polyline.closed);
}

export function asSpline(object: StoredObject): SplineGeometry {
  return object.data as SplineGeometry;
}
export function asMText(object: StoredObject): MTextGeometry {
  return object.data as MTextGeometry;
}
export function asDimension(object: StoredObject): DimensionGeometry {
  return object.data as DimensionGeometry;
}
export function asInsert(object: StoredObject): InsertGeometry {
  return object.data as InsertGeometry;
}
export function asRevcloud(object: StoredObject): RevcloudGeometry {
  return object.data as RevcloudGeometry;
}

/** Every drawable stroke of an object, used for snaps, intersections, hit tests and extents. */
export function objectCurves(object: StoredObject): Curve[] {
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      return [{ kind: 'segment', a: line.start, b: line.end }];
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      return polylineCurves(polyline.vertices, polyline.closed);
    }
    case 'circle': {
      const circle = asCircle(object);
      return [{ kind: 'arc', c: circle.center, r: circle.radius, start: 0, sweep: 360 }];
    }
    case 'arc': {
      const arc = asArc(object);
      return [
        {
          kind: 'arc',
          c: arc.center,
          r: arc.radius,
          start: wrap360(arc.start_angle),
          sweep: arcSweep(arc.start_angle, arc.end_angle),
        },
      ];
    }
    case 'spline': {
      const spline = asSpline(object);
      return polylineCurves(spline.fit_points, false);
    }
    case 'insert':
      return placedBlockParts(asInsert(object)).flatMap((part) => part.curves);
    case 'revcloud': {
      const cloud = asRevcloud(object);
      return revcloudStrokes(cloud.first, cloud.opposite);
    }
    case 'mtext':
    case 'dimension':
      return [];
  }
}

export function objectSnaps(object: StoredObject): SnapSet {
  const endpoint: Point[] = [];
  const midpoint: Point[] = [];
  const center: Point[] = [];
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      endpoint.push(line.start, line.end);
      midpoint.push(scaled(add(line.start, line.end), 0.5));
      break;
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      endpoint.push(...polyline.vertices);
      for (const curve of polylineCurves(polyline.vertices, polyline.closed)) {
        if (curve.kind === 'segment') midpoint.push(scaled(add(curve.a, curve.b), 0.5));
      }
      break;
    }
    case 'circle': {
      center.push(asCircle(object).center);
      break;
    }
    case 'arc': {
      const arc = asArc(object);
      const sweep = arcSweep(arc.start_angle, arc.end_angle);
      endpoint.push(...arcEndpoints({ c: arc.center, r: arc.radius, start: arc.start_angle, sweep }));
      midpoint.push(polar(arc.center, arc.radius, arc.start_angle + sweep / 2));
      center.push(arc.center);
      break;
    }
    case 'insert': {
      for (const part of placedBlockParts(asInsert(object))) {
        endpoint.push(...part.endpoints);
        midpoint.push(...part.midpoints);
        center.push(...part.centers);
      }
      break;
    }
    case 'spline':
    case 'mtext':
    case 'dimension':
    case 'revcloud':
      break;
  }
  return {
    endpoint: dedupePoints(endpoint),
    midpoint: dedupePoints(midpoint),
    center: dedupePoints(center),
  };
}

export function dedupePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const point of points) {
    const rounded = roundPoint(point);
    const key = `${rounded[0]},${rounded[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rounded);
  }
  return result;
}

export function objectExtents(object: StoredObject): Extents | null {
  if (object.type === 'mtext') {
    const text = asMText(object);
    return {
      min: text.position,
      max: [text.position[0] + text.width, text.position[1] + text.height],
    };
  }
  if (object.type === 'dimension') {
    const dimension = asDimension(object);
    const points = [...dimension.points, dimension.location];
    return mergeExtents(points.map((point) => ({ min: point, max: point })));
  }
  const curves = objectCurves(object);
  if (curves.length === 0) return null;
  return mergeExtents(curves.map(curveExtents));
}

export function distanceToObject(point: Point, object: StoredObject): number {
  if (object.type === 'mtext') {
    const text = asMText(object);
    return distance(point, text.position);
  }
  if (object.type === 'dimension') {
    const dimension = asDimension(object);
    return distance(point, dimension.location);
  }
  const curves = objectCurves(object);
  if (curves.length === 0) return Infinity;
  return Math.min(...curves.map((curve) => distanceToCurve(point, curve)));
}

/** Every intersection snap point among a set of objects. */
export function intersectionPoints(objects: StoredObject[]): Point[] {
  const curvesByObject = objects.map(objectCurves);
  const points: Point[] = [];
  for (let i = 0; i < curvesByObject.length; i += 1) {
    for (let j = i + 1; j < curvesByObject.length; j += 1) {
      for (const first of curvesByObject[i]!) {
        for (const second of curvesByObject[j]!) {
          points.push(...curveIntersections(first, second));
        }
      }
    }
  }
  return dedupePoints(points);
}

export function dimensionRadius(dimension: DimensionGeometry, all: Map<string, StoredObject>): number | null {
  const handle = dimension.handles[0];
  if (handle === undefined) return null;
  const target = all.get(handle);
  if (target === undefined) return null;
  if (target.type === 'circle') return asCircle(target).radius;
  if (target.type === 'arc') return asArc(target).radius;
  return null;
}

function dimensionLines(
  dimension: DimensionGeometry,
  all: Map<string, StoredObject>,
): Array<{ start: Point; end: Point }> {
  return dimension.handles.map((handle) => {
    const target = all.get(handle);
    if (target === undefined || target.type !== 'line') return { start: [0, 0] as Point, end: [1, 0] as Point };
    const line = asLine(target);
    return { start: line.start, end: line.end };
  });
}

export function dimensionPoints(dimension: DimensionGeometry, all: Map<string, StoredObject>): Point[] {
  if (dimension.kind === 'linear' || dimension.kind === 'aligned') return dimension.points;
  if (dimension.kind === 'radius') {
    const handle = dimension.handles[0];
    const target = handle === undefined ? undefined : all.get(handle);
    if (target?.type === 'circle') return [asCircle(target).center];
    if (target?.type === 'arc') return [asArc(target).center];
    return dimension.points;
  }
  const ends = dimensionLines(dimension, all).flatMap((line) => [line.start, line.end]);
  return ends.length === 4 ? ends : dimension.points;
}

export function measurementOf(object: StoredObject, all: Map<string, StoredObject>): number {
  const dimension = asDimension(object);
  return dimensionMeasurement(
    dimension.kind,
    dimensionPoints(dimension, all),
    dimension.location,
    dimensionRadius(dimension, all),
    dimensionLines(dimension, all),
  );
}

/** The measurement in the drawing's units, without any override applied. */
export function measurementText(kind: DimensionKind, measurement: number, units: Units): string {
  return kind === 'angular' ? formatAngle(measurement) : formatLength(measurement, units);
}

/** The text a dimension shows: the measurement, or the override with `<>` standing for it. */
export function dimensionText(
  kind: DimensionKind,
  measurement: number,
  units: Units,
  override: string | null,
): string {
  const plain = measurementText(kind, measurement, units);
  if (override === null) return kind === 'radius' ? `R${plain}` : plain;
  return override.replaceAll('<>', plain);
}

export function serializeObject(
  object: StoredObject,
  all: Map<string, StoredObject>,
  units: Units,
): DrawingObject {
  const common = {
    handle: object.handle,
    layer: object.layer,
    color: object.color,
    linetype: object.linetype,
    linetype_scale: round6(object.linetype_scale),
    lineweight: object.lineweight,
    dimension_style: object.dimension_style,
    text_style: object.text_style,
    multileader_style: object.multileader_style,
    snaps: objectSnaps(object),
  };
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      return {
        ...common,
        type: 'line',
        start: roundPoint(line.start),
        end: roundPoint(line.end),
        length: round6(distance(line.start, line.end)),
        angle: round6(angleOf(sub(line.end, line.start))),
      };
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      return {
        ...common,
        type: 'polyline',
        vertices: polyline.vertices.map(roundPoint),
        closed: polyline.closed,
        length: round6(polylineLength(polyline.vertices, polyline.closed)),
        area: polyline.closed ? round6(polygonArea(polyline.vertices)) : null,
      };
    }
    case 'circle': {
      const circle = asCircle(object);
      return {
        ...common,
        type: 'circle',
        center: roundPoint(circle.center),
        radius: round6(circle.radius),
        diameter: round6(circle.radius * 2),
        circumference: round6(2 * Math.PI * circle.radius),
        area: round6(Math.PI * circle.radius * circle.radius),
      };
    }
    case 'arc': {
      const arc = asArc(object);
      return {
        ...common,
        type: 'arc',
        center: roundPoint(arc.center),
        radius: round6(arc.radius),
        start_angle: round6(wrap360(arc.start_angle)),
        end_angle: round6(wrap360(arc.end_angle)),
        length: round6(arcLength(arc.radius, arc.start_angle, arc.end_angle)),
      };
    }
    case 'spline': {
      return { ...common, type: 'spline', fit_points: asSpline(object).fit_points.map(roundPoint) };
    }
    case 'mtext': {
      const text = asMText(object);
      return {
        ...common,
        type: 'mtext',
        position: roundPoint(text.position),
        width: round6(text.width),
        height: round6(text.height),
        contents: text.contents,
      };
    }
    case 'dimension': {
      const dimension = asDimension(object);
      const measurement = measurementOf(object, all);
      return {
        ...common,
        type: 'dimension',
        kind: dimension.kind,
        points: dimensionPoints(dimension, all).map(roundPoint),
        location: roundPoint(dimension.location),
        measurement: round6(measurement),
        text_override: dimension.text_override,
        text: dimensionText(dimension.kind, measurement, units, dimension.text_override),
      };
    }
    case 'insert': {
      const insert = asInsert(object);
      return {
        ...common,
        type: 'insert',
        block: insert.block,
        position: roundPoint(insert.position),
        scale: round6(insert.scale),
        rotation: round6(wrap360(insert.rotation)),
      };
    }
    case 'revcloud': {
      const cloud = asRevcloud(object);
      return {
        ...common,
        type: 'revcloud',
        first: roundPoint(cloud.first),
        opposite: roundPoint(cloud.opposite),
        arcs: revcloudArcs(cloud.first, cloud.opposite),
      };
    }
  }
}

/** Applies a point transform to an object's geometry, keeping its identity. */
export function transformGeometry(
  object: StoredObject,
  mapPoint: (point: Point) => Point,
  options: { rotation?: number; scale?: number } = {},
): ObjectGeometry {
  const rotation = options.rotation ?? 0;
  const factor = options.scale ?? 1;
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      return { start: mapPoint(line.start), end: mapPoint(line.end) };
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      return { vertices: polyline.vertices.map(mapPoint), closed: polyline.closed };
    }
    case 'circle': {
      const circle = asCircle(object);
      return { center: mapPoint(circle.center), radius: circle.radius * factor };
    }
    case 'arc': {
      const arc = asArc(object);
      const sweep = arcSweep(arc.start_angle, arc.end_angle);
      const start = wrap360(arc.start_angle + rotation);
      return {
        center: mapPoint(arc.center),
        radius: arc.radius * factor,
        start_angle: start,
        end_angle: wrap360(start + sweep),
      };
    }
    case 'spline': {
      return { fit_points: asSpline(object).fit_points.map(mapPoint) };
    }
    case 'mtext': {
      const text = asMText(object);
      return {
        position: mapPoint(text.position),
        width: text.width * factor,
        height: text.height * factor,
        contents: text.contents,
      };
    }
    case 'dimension': {
      const dimension = asDimension(object);
      return {
        ...dimension,
        points: dimension.points.map(mapPoint),
        location: mapPoint(dimension.location),
      };
    }
    case 'insert': {
      const insert = asInsert(object);
      return {
        block: insert.block,
        position: mapPoint(insert.position),
        scale: insert.scale * factor,
        rotation: wrap360(insert.rotation + rotation),
      };
    }
    case 'revcloud': {
      const cloud = asRevcloud(object);
      return { first: mapPoint(cloud.first), opposite: mapPoint(cloud.opposite) };
    }
  }
}

export function movedGeometry(object: StoredObject, shift: Point): ObjectGeometry {
  return transformGeometry(object, (point) => add(point, shift));
}

export function rotatedGeometry(object: StoredObject, base: Point, angle: number): ObjectGeometry {
  return transformGeometry(object, (point) => rotateAbout(point, base, angle), { rotation: angle });
}

export function scaledGeometry(object: StoredObject, base: Point, factor: number): ObjectGeometry {
  return transformGeometry(object, (point) => add(base, scaled(sub(point, base), factor)), { scale: factor });
}

export function mirroredGeometry(object: StoredObject, first: Point, second: Point): ObjectGeometry {
  const axisAngle = angleOf(sub(second, first));
  const map = (point: Point): Point => mirrorAbout(point, first, second);
  if (object.type === 'arc') {
    const arc = asArc(object);
    return {
      center: map(arc.center),
      radius: arc.radius,
      start_angle: wrap360(2 * axisAngle - arc.end_angle),
      end_angle: wrap360(2 * axisAngle - arc.start_angle),
    };
  }
  if (object.type === 'insert') {
    const insert = asInsert(object);
    return { ...insert, position: map(insert.position), rotation: wrap360(2 * axisAngle - insert.rotation) };
  }
  return transformGeometry(object, map);
}
