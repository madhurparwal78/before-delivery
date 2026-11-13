import { round } from "../../shared/format.js";
import type { Point, SnapBuckets, Units } from "../../shared/types.js";
import {
  arcLength,
  arcPoint,
  dedupePoints,
  lineAngle,
  lineLength,
  objectSegments,
  polygonArea,
  polylineLength,
} from "./geometry.js";

export interface StoredGeometry {
  handle: string;
  layer: string;
  type: string;
  color: string;
  linetype: string;
  linetype_scale: number;
  lineweight: string;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
  geometry: Record<string, unknown>;
  created_epoch: number;
}

/** Derived values computed once, on the server. */
export function derive(type: string, geometry: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "line": {
      const start = geometry.start as Point;
      const end = geometry.end as Point;
      return { length: lineLength({ a: start, b: end }), angle: lineAngle({ a: start, b: end }) };
    }
    case "polyline": {
      const vertices = geometry.vertices as Point[];
      const closed = geometry.closed as boolean;
      return {
        length: polylineLength(vertices, closed),
        area: closed ? polygonArea(vertices) : null,
      };
    }
    case "circle": {
      const radius = geometry.radius as number;
      return {
        diameter: round(radius * 2, 6),
        circumference: round(2 * Math.PI * radius, 6),
        area: round(Math.PI * radius * radius, 6),
      };
    }
    case "arc": {
      return {
        length: arcLength(
          geometry.radius as number,
          geometry.start_angle as number,
          geometry.end_angle as number,
        ),
      };
    }
    case "dimension": {
      return { measurement: geometry.measurement as number, text: dimensionText(geometry, "mm") };
    }
    case "revcloud": {
      return { arcs: revcloudArcs(geometry.first as Point, geometry.opposite as Point) };
    }
    default:
      return {};
  }
}

export function revcloudArcs(first: Point, opposite: Point): number {
  const w = Math.abs(opposite[0] - first[0]);
  const h = Math.abs(opposite[1] - first[1]);
  return Math.ceil(w / 150) + Math.ceil(h / 150) + Math.ceil(w / 150) + Math.ceil(h / 150);
}

/** Snap candidates for one object. */
export function objectSnaps(geometry: Record<string, unknown>, type: string): SnapBuckets {
  const endpoint: Point[] = [];
  const midpoint: Point[] = [];
  const center: Point[] = [];
  switch (type) {
    case "line": {
      const s = geometry.start as Point;
      const e = geometry.end as Point;
      endpoint.push(s, e);
      midpoint.push([round((s[0] + e[0]) / 2, 6), round((s[1] + e[1]) / 2, 6)]);
      center.push();
      break;
    }
    case "polyline": {
      const vertices = geometry.vertices as Point[];
      const closed = geometry.closed as boolean;
      endpoint.push(...vertices);
      for (let i = 0; i + 1 < vertices.length; i++) {
        midpoint.push([
          round((vertices[i][0] + vertices[i + 1][0]) / 2, 6),
          round((vertices[i][1] + vertices[i + 1][1]) / 2, 6),
        ]);
      }
      if (closed && vertices.length > 1) {
        const a = vertices[vertices.length - 1];
        const b = vertices[0];
        midpoint.push([round((a[0] + b[0]) / 2, 6), round((a[1] + b[1]) / 2, 6)]);
      }
      break;
    }
    case "circle": {
      center.push(geometry.center as Point);
      break;
    }
    case "arc": {
      const c = geometry.center as Point;
      const r = geometry.radius as number;
      const s = geometry.start_angle as number;
      const e = geometry.end_angle as number;
      endpoint.push(arcPoint(c, r, s), arcPoint(c, r, e));
      midpoint.push(arcPoint(c, r, (s + arcSpan(s, e) / 2) % 360));
      center.push(c);
      break;
    }
    case "spline": {
      const pts = geometry.fit_points as Point[];
      endpoint.push(...pts);
      break;
    }
    case "mtext": {
      center.push(geometry.position as Point);
      break;
    }
    case "insert": {
      center.push(geometry.position as Point);
      break;
    }
    case "dimension": {
      const points = geometry.points as Point[];
      endpoint.push(...points, geometry.location as Point);
      break;
    }
    case "revcloud": {
      const first = geometry.first as Point;
      const opposite = geometry.opposite as Point;
      endpoint.push(first, opposite);
      break;
    }
  }
  void center;
  return {
    endpoint: dedupePoints(endpoint),
    midpoint: dedupePoints(midpoint),
    center: dedupePoints(center),
  };
}

function arcSpan(start: number, end: number): number {
  let sweep = ((end - start) % 360 + 360) % 360;
  if (sweep === 0) sweep = 360;
  return sweep;
}

export function dimensionText(geometry: Record<string, unknown>, units: Units): string {
  const measurement = geometry.measurement as number;
  const override = geometry.text_override as string | null;
  const shown = formatMeasurement(measurement, units, geometry.kind as string);
  if (override === null || override === undefined) return shown;
  return override.replace(/<>/g, shown);
}

export function formatMeasurement(value: number, units: Units, kind: string): string {
  if (kind === "angular") {
    return `${round(value, 2).toFixed(2)}°`;
  }
  if (units === "m") return `${(value / 1000).toFixed(3)}`;
  return `${value.toFixed(2)}`;
}

/** The public object shape the API returns. */
export function publicObject(row: StoredGeometry, units: Units): Record<string, unknown> {
  const snaps = objectSnaps(row.geometry, row.type);
  const derived = derive(row.type, row.geometry);
  const text = row.type === "dimension" ? dimensionText(row.geometry, units) : undefined;
  return {
    handle: row.handle,
    type: row.type,
    layer: row.layer,
    color: row.color,
    linetype: row.linetype,
    linetype_scale: Number(row.linetype_scale),
    lineweight: row.lineweight,
    dimension_style: row.dimension_style,
    text_style: row.text_style,
    multileader_style: row.multileader_style,
    snaps,
    ...row.geometry,
    ...derived,
    ...(text !== undefined ? { text } : {}),
  };
}

/** Block geometry as fit points and segments for snapping after transform. */
export function blockSegments(
  definition: { base: Point; objects: Array<Record<string, unknown>> },
  position: Point,
  scale: number,
  rotation: number,
): SegList {
  const transformed: SegList = { segments: [], points: [], centers: [] };
  const rad = (rotation * Math.PI) / 180;
  const map = (p: Point): Point => {
    const dx = (p[0] - definition.base[0]) * scale;
    const dy = (p[1] - definition.base[1]) * scale;
    return [
      round(position[0] + dx * Math.cos(rad) - dy * Math.sin(rad), 6),
      round(position[1] + dx * Math.sin(rad) + dy * Math.cos(rad), 6),
    ];
  };
  for (const obj of definition.objects) {
    if (obj.kind === "line") {
      transformed.segments.push([map(obj.start as Point), map(obj.end as Point)]);
    } else if (obj.kind === "polyline") {
      const vertices = (obj.vertices as number[]).length % 2 === 0 && !Array.isArray((obj.vertices as unknown[])[0])
        ? pairs(obj.vertices as number[])
        : (obj.vertices as Point[]);
      for (let i = 0; i + 1 < vertices.length; i++) {
        transformed.segments.push([map(vertices[i]), map(vertices[i + 1])]);
      }
      if (obj.closed && vertices.length > 1) transformed.segments.push([map(vertices[vertices.length - 1]), map(vertices[0])]);
    } else if (obj.kind === "arc") {
      const c = map(obj.center as Point);
      const r = (obj.radius as number) * scale;
      const s = (obj.start_angle as number) + rotation;
      const e = (obj.end_angle as number) + rotation;
      const steps = 16;
      let sweep = ((e - s) % 360 + 360) % 360;
      if (sweep === 0) sweep = 360;
      for (let i = 0; i < steps; i++) {
        const a1 = s + (i * sweep) / steps;
        const a2 = s + ((i + 1) * sweep) / steps;
        transformed.segments.push([
          arcPoint(c, r, a1),
          arcPoint(c, r, a2),
        ]);
      }
      transformed.centers.push(c);
      transformed.points.push(arcPoint(c, r, s), arcPoint(c, r, e));
    } else if (obj.kind === "mtext") {
      transformed.centers.push(map(obj.position as Point));
    }
  }
  return transformed;
}

function pairs(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

export interface SegList {
  segments: Array<[Point, Point]>;
  points: Point[];
  centers: Point[];
}

/** Full extent of an object's drawn geometry. */
export function objectBounds(geometry: Record<string, unknown>, type: string): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const segs = objectSegments(geometry, type);
  if (segs.length === 0) {
    if (type === "insert") {
      const pos = geometry.position as Point;
      return { minX: pos[0], maxX: pos[0], minY: pos[1], maxY: pos[1] };
    }
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return { minX, maxX, minY, maxY };
}
