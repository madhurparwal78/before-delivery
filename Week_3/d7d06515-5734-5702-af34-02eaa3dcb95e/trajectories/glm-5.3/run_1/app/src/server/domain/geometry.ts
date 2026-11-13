import { distance, normaliseAngle, round } from "../../shared/format.js";
import type { Point } from "../../shared/types.js";

export interface Seg {
  a: Point;
  b: Point;
}

export function lineLength(s: Seg): number {
  return round(distance(s.a, s.b), 6);
}

export function lineAngle(s: Seg): number {
  return normaliseAngle((Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180) / Math.PI);
}

export function polylineLength(vertices: Point[], closed: boolean): number {
  let total = 0;
  for (let i = 0; i + 1 < vertices.length; i++) total += distance(vertices[i], vertices[i + 1]);
  if (closed && vertices.length > 2) total += distance(vertices[vertices.length - 1], vertices[0]);
  return round(total, 6);
}

/** Shoelace area; positive when counter-clockwise. */
export function polygonArea(vertices: Point[]): number {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % vertices.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return round(Math.abs(area) / 2, 6);
}

export function arcLength(radius: number, startAngle: number, endAngle: number): number {
  let sweep = normaliseAngle(endAngle) - normaliseAngle(startAngle);
  if (sweep <= 0) sweep += 360;
  return round((sweep / 360) * 2 * Math.PI * radius, 6);
}

export function arcPoint(center: Point, radius: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return [round(center[0] + radius * Math.cos(rad), 6), round(center[1] + radius * Math.sin(rad), 6)];
}

/** Distance from p to segment ab, and the closest point. */
export function pointToSeg(p: Point, a: Point, b: Point): { dist: number; closest: Point; t: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const closest: Point = [round(a[0] + t * vx, 6), round(a[1] + t * vy, 6)];
  return { dist: distance(p, closest), closest, t };
}

export function pointToCircle(p: Point, center: Point, radius: number): number {
  return Math.abs(distance(p, center) - radius);
}

/** Parameter of a point along a segment, 0 at a, 1 at b. */
export function segParam(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return 0;
  return ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2;
}

export interface RayHit {
  point: Point;
  dist: number;
}

/** Intersection of two infinite lines (ax,ay)-(bx,by) and (cx,cy)-(dx,dy). */
export function lineLineIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r: Point = [b[0] - a[0], b[1] - a[1]];
  const s: Point = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  return [round(a[0] + t * r[0], 6), round(a[1] + t * r[1], 6)];
}

/** Intersections between a segment and a circle. */
export function segCircleIntersect(a: Point, b: Point, center: Point, radius: number): Point[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - center[0];
  const fy = a[1] - center[1];
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: Point[] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) {
      out.push([round(a[0] + t * dx, 6), round(a[1] + t * dy, 6)]);
    }
  }
  return dedupePoints(out);
}

export function segSegIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const p = lineLineIntersect(a, b, c, d);
  if (!p) return null;
  const eps = 1e-6;
  const within = (p: Point, x: Point, y: Point): boolean =>
    p[0] >= Math.min(x[0], y[0]) - eps &&
    p[0] <= Math.max(x[0], y[0]) + eps &&
    p[1] >= Math.min(x[1], y[1]) - eps &&
    p[1] <= Math.max(x[1], y[1]) + eps;
  if (within(p, a, b) && within(p, c, d)) return p;
  return null;
}

export function dedupePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const p of points) {
    const key = `${round(p[0], 4)},${round(p[1], 4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([round(p[0], 6), round(p[1], 6)]);
    }
  }
  return out;
}

/** Intersections between two circles. */
export function circleCircleIntersect(c1: Point, r1: number, c2: Point, r2: number): Point[] {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const xm = c1[0] + (a * dx) / d;
  const ym = c1[1] + (a * dy) / d;
  return dedupePoints([
    [round(xm + (h * dy) / d, 6), round(ym - (h * dx) / d, 6)],
    [round(xm - (h * dy) / d, 6), round(ym + (h * dx) / d, 6)],
  ]);
}

/** Intersections between a line segment and an arc (part circle). */
export function segArcIntersect(a: Point, b: Point, center: Point, radius: number, startAngle: number, endAngle: number): Point[] {
  return segCircleIntersect(a, b, center, radius).filter((p) => angleOnArc(
    (Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI,
    startAngle,
    endAngle,
  ));
}

export function angleOnArc(angle: number, startAngle: number, endAngle: number): boolean {
  const a = normaliseAngle(angle);
  const s = normaliseAngle(startAngle);
  const e = normaliseAngle(endAngle);
  if (s === e) return false;
  return s < e ? a >= s && a < e : a >= s || a < e;
}

/** Distance from a point to an arc, measured to the part-circle. */
export function pointToArc(p: Point, center: Point, radius: number, startAngle: number, endAngle: number): number {
  const angle = (Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI;
  if (angleOnArc(angle, startAngle, endAngle)) return Math.abs(distance(p, center) - radius);
  const s = arcPoint(center, radius, startAngle);
  const e = arcPoint(center, radius, endAngle);
  return Math.min(distance(p, s), distance(p, e));
}

/** Point-to-object distance for selection by typed point (10 mm) and picking. */
export function pointToObjectDistance(p: Point, geometry: Record<string, unknown>, type: string): number {
  switch (type) {
    case "line": {
      return pointToSeg(p, geometry.start as Point, geometry.end as Point).dist;
    }
    case "polyline": {
      const vertices = geometry.vertices as Point[];
      const closed = geometry.closed as boolean;
      let best = Infinity;
      const edges: Array<[Point, Point]> = [];
      for (let i = 0; i + 1 < vertices.length; i++) edges.push([vertices[i], vertices[i + 1]]);
      if (closed && vertices.length > 1) edges.push([vertices[vertices.length - 1], vertices[0]]);
      for (const [a, b] of edges) best = Math.min(best, pointToSeg(p, a, b).dist);
      return best === Infinity ? Infinity : best;
    }
    case "circle":
      return pointToCircle(p, geometry.center as Point, geometry.radius as number);
    case "arc":
      return pointToArc(
        p,
        geometry.center as Point,
        geometry.radius as number,
        geometry.start_angle as number,
        geometry.end_angle as number,
      );
    case "spline": {
      const points = geometry.fit_points as Point[];
      let best = Infinity;
      for (let i = 0; i + 1 < points.length; i++) best = Math.min(best, pointToSeg(p, points[i], points[i + 1]).dist);
      return best === Infinity ? Infinity : best;
    }
    case "mtext": {
      const pos = geometry.position as Point;
      const w = geometry.width as number;
      return pointToSeg(p, pos, [pos[0] + w, pos[1]]).dist;
    }
    case "dimension": {
      const points = geometry.points as Point[];
      const location = geometry.location as Point;
      let best = Infinity;
      if (points.length >= 2) {
        const mid: Point = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        best = pointToSeg(p, points[0], location).dist;
        best = Math.min(best, pointToSeg(p, points[1], location).dist);
        best = Math.min(best, pointToSeg(p, mid, location).dist);
      }
      return best;
    }
    case "insert": {
      const pos = geometry.position as Point;
      return distance(p, pos);
    }
    case "revcloud": {
      const first = geometry.first as Point;
      const opposite = geometry.opposite as Point;
      const corners: Point[] = [
        first,
        [opposite[0], first[1]],
        opposite,
        [first[0], opposite[1]],
      ];
      let best = Infinity;
      for (let i = 0; i < 4; i++) best = Math.min(best, pointToSeg(p, corners[i], corners[(i + 1) % 4]).dist);
      return best;
    }
    default:
      return Infinity;
  }
}

/** Segment list of an object, for TRIM cutting edges and intersections. */
export function objectSegments(geometry: Record<string, unknown>, type: string): Seg[] {
  switch (type) {
    case "line":
      return [{ a: geometry.start as Point, b: geometry.end as Point }];
    case "polyline": {
      const vertices = geometry.vertices as Point[];
      const closed = geometry.closed as boolean;
      const segs: Seg[] = [];
      for (let i = 0; i + 1 < vertices.length; i++) segs.push({ a: vertices[i], b: vertices[i + 1] });
      if (closed && vertices.length > 1) segs.push({ a: vertices[vertices.length - 1], b: vertices[0] });
      return segs;
    }
    case "spline": {
      const points = geometry.fit_points as Point[];
      const segs: Seg[] = [];
      for (let i = 0; i + 1 < points.length; i++) segs.push({ a: points[i], b: points[i + 1] });
      return segs;
    }
    case "circle": {
      const c = geometry.center as Point;
      const r = geometry.radius as number;
      const segs: Seg[] = [];
      const steps = 64;
      for (let i = 0; i < steps; i++) {
        segs.push({ a: arcPoint(c, r, (i * 360) / steps), b: arcPoint(c, r, ((i + 1) * 360) / steps) });
      }
 return segs;
    }
    case "arc": {
      const c = geometry.center as Point;
      const r = geometry.radius as number;
      const s = geometry.start_angle as number;
      const e = geometry.end_angle as number;
      let sweep = normaliseAngle(e) - normaliseAngle(s);
      if (sweep <= 0) sweep += 360;
      const steps = Math.max(4, Math.ceil((sweep / 360) * 64));
      const segs: Seg[] = [];
      for (let i = 0; i < steps; i++) {
        const a1 = s + (i * sweep) / steps;
        const a2 = s + ((i + 1) * sweep) / steps;
        segs.push({ a: arcPoint(c, r, a1), b: arcPoint(c, r, a2) });
      }
      return segs;
    }
    case "mtext": {
      const pos = geometry.position as Point;
      const w = geometry.width as number;
      return [{ a: pos, b: [pos[0] + w, pos[1]] }];
    }
    case "dimension": {
      const points = geometry.points as Point[];
      const location = geometry.location as Point;
      const segs: Seg[] = [];
      if (points.length >= 2) {
        segs.push({ a: points[0], b: location });
        segs.push({ a: points[1], b: location });
        const mid: Point = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        segs.push({ a: mid, b: location });
      }
      return segs;
    }
    case "insert": {
      return [];
    }
    case "revcloud": {
      const first = geometry.first as Point;
      const opposite = geometry.opposite as Point;
      return [
        { a: first, b: [opposite[0], first[1]] },
        { a: [opposite[0], first[1]], b: opposite },
        { a: opposite, b: [first[0], opposite[1]] },
        { a: [first[0], opposite[1]], b: first },
      ];
    }
    default:
      return [];
  }
}

/** All intersections between object geometry, for the intersections list. */
export function intersectObjects(
  items: Array<{ geometry: Record<string, unknown>; type: string }>,
): Point[] {
  const collected: Point[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      collected.push(...intersectTwo(items[i], items[j]));
    }
  }
  return dedupePoints(collected);
}

export function intersectTwo(
  a: { geometry: Record<string, unknown>; type: string },
  b: { geometry: Record<string, unknown>; type: string },
): Point[] {
  const aSegs = objectSegments(a.geometry, a.type);
  const bSegs = objectSegments(b.geometry, b.type);
  const out: Point[] = [];
  if (aSegs.length === 0 && bSegs.length === 0) return out;
  for (const sa of aSegs) {
    for (const sb of bSegs) {
      const p = segSegIntersect(sa.a, sa.b, sb.a, sb.b);
      if (p) out.push(p);
    }
  }
  return dedupePoints(out);
}
