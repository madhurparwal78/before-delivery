import type { Point } from '../shared/api';
import type { Units } from '../shared/format';
import {
  add,
  angleOf,
  arcSweep,
  distance,
  dot,
  norm,
  placedBlockParts,
  polylineCurves,
  revcloudStrokes,
  scaled,
  sub,
  wrap360,
  type Curve,
} from './geometry';
import {
  asArc,
  asCircle,
  asDimension,
  asInsert,
  asLine,
  asMText,
  asPolyline,
  asRevcloud,
  asSpline,
  dimensionPoints,
  dimensionText,
  measurementOf,
  type StoredObject,
} from './model';

export const DIMENSION_TEXT_HEIGHT = 250;

export interface RenderText {
  position: Point;
  height: number;
  text: string;
}

export interface RenderedObject {
  curves: Curve[];
  texts: RenderText[];
}

function perpendicular(direction: Point): Point {
  const length = norm(direction);
  return [-direction[1] / length, direction[0] / length];
}

/** The strokes and text a dimension draws, shared by the PDF sheet and the DXF export. */
export function renderDimension(object: StoredObject, all: Map<string, StoredObject>, units: Units): RenderedObject {
  const dimension = asDimension(object);
  const measurement = measurementOf(object, all);
  const text = dimensionText(dimension.kind, measurement, units, dimension.text_override);
  const points = dimensionPoints(dimension, all);
  const location = dimension.location;
  const curves: Curve[] = [];

  if (dimension.kind === 'linear') {
    const [first, second] = points as [Point, Point];
    const horizontal = measurement === Math.abs(second[0] - first[0]);
    const a: Point = horizontal ? [first[0], location[1]] : [location[0], first[1]];
    const b: Point = horizontal ? [second[0], location[1]] : [location[0], second[1]];
    curves.push({ kind: 'segment', a, b });
    curves.push({ kind: 'segment', a: first, b: a });
    curves.push({ kind: 'segment', a: second, b: b });
    return { curves, texts: [{ position: scaled(add(a, b), 0.5), height: DIMENSION_TEXT_HEIGHT, text }] };
  }

  if (dimension.kind === 'aligned') {
    const [first, second] = points as [Point, Point];
    const direction = sub(second, first);
    const normal = perpendicular(direction);
    const offset = dot(sub(location, first), normal);
    const a = add(first, scaled(normal, offset));
    const b = add(second, scaled(normal, offset));
    curves.push({ kind: 'segment', a, b });
    curves.push({ kind: 'segment', a: first, b: a });
    curves.push({ kind: 'segment', a: second, b: b });
    return { curves, texts: [{ position: scaled(add(a, b), 0.5), height: DIMENSION_TEXT_HEIGHT, text }] };
  }

  if (dimension.kind === 'radius') {
    const centre = points[0] ?? location;
    curves.push({ kind: 'segment', a: centre, b: location });
    return { curves, texts: [{ position: location, height: DIMENSION_TEXT_HEIGHT, text }] };
  }

  const ends = points;
  if (ends.length === 4) {
    curves.push({ kind: 'segment', a: ends[0]!, b: ends[1]! });
    curves.push({ kind: 'segment', a: ends[2]!, b: ends[3]! });
  }
  return { curves, texts: [{ position: location, height: DIMENSION_TEXT_HEIGHT, text }] };
}

export function renderObject(object: StoredObject, all: Map<string, StoredObject>, units: Units): RenderedObject {
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      return { curves: [{ kind: 'segment', a: line.start, b: line.end }], texts: [] };
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      return { curves: polylineCurves(polyline.vertices, polyline.closed), texts: [] };
    }
    case 'circle': {
      const circle = asCircle(object);
      return { curves: [{ kind: 'arc', c: circle.center, r: circle.radius, start: 0, sweep: 360 }], texts: [] };
    }
    case 'arc': {
      const arc = asArc(object);
      return {
        curves: [
          {
            kind: 'arc',
            c: arc.center,
            r: arc.radius,
            start: wrap360(arc.start_angle),
            sweep: arcSweep(arc.start_angle, arc.end_angle),
          },
        ],
        texts: [],
      };
    }
    case 'spline': {
      return { curves: polylineCurves(asSpline(object).fit_points, false), texts: [] };
    }
    case 'mtext': {
      const text = asMText(object);
      return { curves: [], texts: [{ position: text.position, height: text.height, text: text.contents }] };
    }
    case 'insert': {
      const curves: Curve[] = [];
      const texts: RenderText[] = [];
      for (const part of placedBlockParts(asInsert(object))) {
        curves.push(...part.curves);
        if (part.part.kind === 'mtext') {
          texts.push({ position: part.part.position, height: part.part.height, text: part.part.contents });
        }
      }
      return { curves, texts };
    }
    case 'revcloud': {
      const cloud = asRevcloud(object);
      return { curves: revcloudStrokes(cloud.first, cloud.opposite), texts: [] };
    }
    case 'dimension':
      return renderDimension(object, all, units);
  }
}

/** Flattens a curve into a polyline for vector output, keeping arcs smooth. */
export function flattenCurve(curve: Curve): Point[] {
  if (curve.kind === 'segment') return [curve.a, curve.b];
  const steps = Math.max(8, Math.ceil(curve.sweep / 6));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = curve.start + (curve.sweep * i) / steps;
    const radians = (angle * Math.PI) / 180;
    points.push([curve.c[0] + curve.r * Math.cos(radians), curve.c[1] + curve.r * Math.sin(radians)]);
  }
  return points;
}

export function curveLength(curve: Curve): number {
  if (curve.kind === 'segment') return distance(curve.a, curve.b);
  return (curve.r * curve.sweep * Math.PI) / 180;
}

export function curveAngle(curve: Curve): number {
  return curve.kind === 'segment' ? angleOf(sub(curve.b, curve.a)) : curve.start;
}
