import { round } from "../../shared/format.js";
import type { Point } from "../../shared/types.js";
import type { StoredObject } from "../command-state.js";
import { pointToObjectDistance } from "./geometry.js";

export function translate(p: Point, dx: number, dy: number): Point {
  return [round(p[0] + dx, 6), round(p[1] + dy, 6)];
}

export function rotatePoint(p: Point, base: Point, rad: number): Point {
  const dx = p[0] - base[0];
  const dy = p[1] - base[1];
  return [
    round(base[0] + dx * Math.cos(rad) - dy * Math.sin(rad), 6),
    round(base[1] + dx * Math.sin(rad) + dy * Math.cos(rad), 6),
  ];
}

export function scalePoint(p: Point, base: Point, factor: number): Point {
  return [round(base[0] + (p[0] - base[0]) * factor, 6), round(base[1] + (p[1] - base[1]) * factor, 6)];
}

export function mirrorPoint(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return p;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const proj: Point = [round(a[0] + t * dx, 6), round(a[1] + t * dy, 6)];
  return [round(2 * proj[0] - p[0], 6), round(2 * proj[1] - p[1], 6)];
}

function mapGeometryPoints(geometry: Record<string, unknown>, type: string, map: (p: Point) => Point): Record<string, unknown> {
  const out: Record<string, unknown> = { ...geometry };
  const apply = (key: string): void => {
    if (Array.isArray(out[key])) out[key] = (out[key] as Point[]).map(map);
  };
  switch (type) {
    case "line":
      out.start = map(geometry.start as Point);
      out.end = map(geometry.end as Point);
      break;
    case "polyline":
    case "spline":
      apply("vertices");
      apply("fit_points");
      break;
    case "circle":
      out.center = map(geometry.center as Point);
      break;
    case "arc":
      out.center = map(geometry.center as Point);
      break;
    case "mtext":
      out.position = map(geometry.position as Point);
      break;
    case "dimension": {
      out.points = (geometry.points as Point[]).map(map);
      out.location = map(geometry.location as Point);
      break;
    }
    case "insert":
      out.position = map(geometry.position as Point);
      break;
    case "revcloud":
      out.first = map(geometry.first as Point);
      out.opposite = map(geometry.opposite as Point);
      break;
  }
  return out;
}

export function translateObject(o: StoredObject, dx: number, dy: number): Record<string, unknown> {
  return mapGeometryPoints(o.geometry, o.type, (p) => translate(p, dx, dy));
}

export function rotateObject(o: StoredObject, base: Point, degrees: number): Record<string, unknown> {
  const rad = (degrees * Math.PI) / 180;
  const mapped = mapGeometryPoints(o.geometry, o.type, (p) => rotatePoint(p, base, rad));
  if (o.type === "insert") mapped.rotation = round(((o.geometry.rotation as number) + degrees) % 360, 6);
  if (o.type === "dimension") remeasure(mapped, o.type);
  return mapped;
}

export function scaleObject(o: StoredObject, base: Point, factor: number): Record<string, unknown> {
  const mapped = mapGeometryPoints(o.geometry, o.type, (p) => scalePoint(p, base, factor));
  switch (o.type) {
    case "circle":
      mapped.radius = round((o.geometry.radius as number) * factor, 6);
      break;
    case "arc":
      mapped.radius = round((o.geometry.radius as number) * factor, 6);
      break;
    case "insert":
      mapped.scale = round((o.geometry.scale as number) * factor, 6);
      break;
    case "mtext":
      mapped.height = round((o.geometry.height as number) * factor, 6);
      mapped.width = round((o.geometry.width as number) * factor, 6);
      break;
  }
  return mapped;
}

export function mirrorObject(o: StoredObject, a: Point, b: Point): Record<string, unknown> {
  return mapGeometryPoints(o.geometry, o.type, (p) => mirrorPoint(p, a, b));
}

function remeasure(geometry: Record<string, unknown>, type: string): void {
  void geometry;
  void type;
}

export function offsetObject(o: StoredObject, distanceValue: number, side: Point): Record<string, unknown> | null {
  switch (o.type) {
    case "line": {
      const s = o.geometry.start as Point;
      const e = o.geometry.end as Point;
      const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
      if (len === 0) return null;
      const nx = (-(e[1] - s[1]) / len) * distanceValue;
      const ny = ((e[0] - s[0]) / len) * distanceValue;
      let dir = 1;
      const mid: Point = [(s[0] + e[0]) / 2 + nx, (s[1] + e[1]) / 2 + ny];
      if (Math.hypot(mid[0] - side[0], mid[1] - side[1]) > Math.hypot(mid[0] - nx - side[0], mid[1] - ny - side[1])) dir = -1;
      return { start: translate(s, nx * dir, ny * dir), end: translate(e, nx * dir, ny * dir) };
    }
    case "circle": {
      const c = o.geometry.center as Point;
      const r = o.geometry.radius as number;
      const grown = Math.hypot(side[0] - c[0], side[1] - c[1]) > r;
      return { center: c, radius: round(r + (grown ? distanceValue : -distanceValue), 6) };
    }
    case "arc": {
      const c = o.geometry.center as Point;
      const r = o.geometry.radius as number;
      const grown = Math.hypot(side[0] - c[0], side[1] - c[1]) > r;
      return {
        center: c,
        radius: round(r + (grown ? distanceValue : -distanceValue), 6),
        start_angle: o.geometry.start_angle,
        end_angle: o.geometry.end_angle,
      };
    }
    case "polyline": {
      const vertices = o.geometry.vertices as Point[];
      const closed = o.geometry.closed as boolean;
      if (vertices.length < 2) return null;
      const centroid: Point = [
        vertices.reduce((s, p) => s + p[0], 0) / vertices.length,
        vertices.reduce((s, p) => s + p[1], 0) / vertices.length,
      ];
      const offsetPolyline = (points: Point[], dist: number): Point[] => {
        const n = points.length;
        const out: Point[] = [];
        for (let i = 0; i < n; i++) {
          const prev = points[(i - 1 + n) % n];
          const next = points[(i + 1) % n];
          const v1 = [points[i][0] - prev[0], points[i][1] - prev[1]];
          const v2 = [next[0] - points[i][0], next[1] - points[i][1]];
          const l1 = Math.hypot(v1[0], v1[1]) || 1;
          const l2 = Math.hypot(v2[0], v2[1]) || 1;
          const n1: Point = [-v1[1] / l1, v1[0] / l1];
          const n2: Point = [-v2[1] / l2, v2[0] / l2];
          const bis: Point = [n1[0] + n2[0], n1[1] + n2[1]];
          const bl = Math.hypot(bis[0], bis[1]) || 1;
          out.push([
            round(points[i][0] + (bis[0] / bl) * dist, 6),
            round(points[i][1] + (bis[1] / bl) * dist, 6),
          ]);
        }
        return out;
      };
      const outside = pointToObjectDistance(side, o.geometry, "polyline") > 0;
      const candidate = offsetPolyline(vertices, distanceValue);
      const candidateCentroid: Point = [
        candidate.reduce((s, p) => s + p[0], 0) / candidate.length,
        candidate.reduce((s, p) => s + p[1], 0) / candidate.length,
      ];
      const grew = Math.hypot(candidateCentroid[0] - centroid[0], candidateCentroid[1] - centroid[1]) > distanceValue * 0.5;
      const dir = outside === grew ? 1 : -1;
      const final = dir === 1 ? candidate : offsetPolyline(vertices, -distanceValue);
      return { vertices: final, closed };
    }
    default:
      return null;
  }
}

export function translateAll(o: StoredObject, dx: number, dy: number): StoredObject {
  return { ...o, geometry: translateObject(o, dx, dy) };
}

export function objectDistanceTo(o: StoredObject, p: Point): number {
  return pointToObjectDistance(p, o.geometry, o.type);
}
