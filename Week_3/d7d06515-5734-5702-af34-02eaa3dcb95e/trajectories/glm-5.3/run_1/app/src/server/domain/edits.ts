import { round } from "../../shared/format.js";
import type { Point } from "../../shared/types.js";
import type { StoredObject } from "../command-state.js";
import { arcPoint, objectSegments, segParam, segSegIntersect, dedupePoints } from "./geometry.js";

export interface TrimOutcome {
  kind: "none" | "shorten" | "split";
  kept?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** All visible base objects are cutting edges. */
export function trimObject(target: StoredObject, pick: Point, edges: StoredObject[]): TrimOutcome {
  const targetSegs = objectSegments(target.geometry, target.type);
  if (targetSegs.length === 0) return { kind: "none" };
  const edgeSegs: Array<{ a: Point; b: Point }> = [];
  for (const e of edges) {
    if (e.handle === target.handle) continue;
    for (const s of objectSegments(e.geometry, e.type)) edgeSegs.push(s);
  }
  const hits: Array<{ point: Point; t: number; segIndex: number }> = [];
  for (let si = 0; si < targetSegs.length; si++) {
    for (const es of edgeSegs) {
      const p = segSegIntersect(targetSegs[si].a, targetSegs[si].b, es.a, es.b);
      if (p) hits.push({ point: p, t: segParam(p, targetSegs[si].a, targetSegs[si].b), segIndex: si });
    }
  }
  if (hits.length === 0) return { kind: "none" };
  const ordered = [...hits].sort((x, y) => x.t - y.t);
  let before: { point: Point; segIndex: number } | null = null;
  let after: { point: Point; segIndex: number } | null = null;
  const pickT = nearestSegInfo(targetSegs, pick);
  for (const h of ordered) {
    if (h.segIndex < pickT.segIndex || (h.segIndex === pickT.segIndex && h.t <= pickT.t + 1e-9)) before = { point: h.point, segIndex: h.segIndex };
    else {
      after = { point: h.point, segIndex: h.segIndex };
      break;
    }
  }
  const startBoundary = before?.point ?? null;
  const endBoundary = after?.point ?? null;
  if (!startBoundary && !endBoundary) return { kind: "none" };
  if (target.type === "line") {
    const s = target.geometry.start as Point;
    const e = target.geometry.end as Point;
    // The removed part runs from the boundary before the pick (or the start)
    // to the boundary after it (or the end). What remains is kept.
    const startCut = startBoundary !== null;
    const endCut = endBoundary !== null;
    if (startCut && endCut) {
      return { kind: "split", kept: { start: startBoundary, end: endBoundary } };
    }
    if (endCut) {
      // The tail up to the boundary goes; the rest stays.
      return { kind: "shorten", kept: { start: endBoundary, end: e } };
    }
    return { kind: "shorten", kept: { start: s, end: startBoundary } };
  }
  if (target.type === "polyline" || target.type === "spline") {
    const key = target.type === "polyline" ? "vertices" : "fit_points";
    const vertices = target.geometry[key] as Point[];
    const closed = (target.geometry.closed as boolean | undefined) ?? false;
    const chain = closed ? [...vertices, vertices[0]] : vertices;
    let chainPoints: Point[] = [];
    for (let i = 0; i + 1 < chain.length; i++) chainPoints.push(chain[i], chain[i + 1]);
    const cutBefore = startBoundary;
    const cutAfter = endBoundary;
    if (cutBefore && cutAfter) {
      return { kind: "split", kept: { [key]: [cutBefore, cutAfter], closed: false } as Record<string, unknown> };
    }
    if (cutBefore && !cutAfter) {
      return { kind: "shorten", kept: { [key]: [cutBefore, ...chain.slice(1)], closed: closed && chain.length > 2 } as Record<string, unknown> };
    }
    if (!cutBefore && cutAfter) {
      return { kind: "shorten", kept: { [key]: [...chain.slice(0, -1), cutAfter], closed: false } as Record<string, unknown> };
    }
  }
  return { kind: "none" };
}

function nearestSegInfo(segs: Array<{ a: Point; b: Point }>, p: Point): { segIndex: number; t: number } {
  let best = { segIndex: 0, t: 0 };
  let bestDist = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const d = segParam(p, s.a, s.b);
    const proj: Point = [s.a[0] + (s.b[0] - s.a[0]) * d, s.a[1] + (s.b[1] - s.a[1]) * d];
    const dist = Math.hypot(proj[0] - p[0], proj[1] - p[1]);
    if (dist < bestDist) {
      bestDist = dist;
      best = { segIndex: i, t: Math.max(0, Math.min(1, d)) };
    }
  }
  return best;
}

export interface ExtendOutcome {
  geometry: Record<string, unknown> | null;
}

/** EXTEND lengthens the picked end to the nearest edge it would meet. */
export function extendObject(target: StoredObject, pick: Point, others: StoredObject[]): ExtendOutcome {
  if (target.type !== "line") return { geometry: null };
  const s = target.geometry.start as Point;
  const e = target.geometry.end as Point;
  const pickNearStart = Math.hypot(pick[0] - s[0], pick[1] - s[1]) <= Math.hypot(pick[0] - e[0], pick[1] - e[1]);
  const rayFrom = pickNearStart ? s : e;
  const rayTo = pickNearStart ? e : s;
  const dir: Point = [rayTo[0] - rayFrom[0], rayTo[1] - rayFrom[1]];
  const len = Math.hypot(dir[0], dir[1]);
  if (len === 0) return { geometry: null };
  const unit: Point = [dir[0] / len, dir[1] / len];
  let best: Point | null = null;
  let bestDist = Infinity;
  for (const o of others) {
    for (const seg of objectSegments(o.geometry, o.type)) {
      const t = raySegIntersect(rayFrom, unit, seg.a, seg.b);
      if (t !== null && t > 1e-9 && t < bestDist) {
        bestDist = t;
        best = [round(rayFrom[0] + unit[0] * t, 6), round(rayFrom[1] + unit[1] * t, 6)];
      }
    }
  }
  if (!best) return { geometry: null };
  return { geometry: pickNearStart ? { start: best, end: e } : { start: s, end: best } };
}

function raySegIntersect(origin: Point, unit: Point, a: Point, b: Point): number | null {
  const v: Point = [b[0] - a[0], b[1] - a[1]];
  const denom = unit[0] * v[1] - unit[1] * v[0];
  if (Math.abs(denom) < 1e-12) return null;
  const w: Point = [a[0] - origin[0], a[1] - origin[1]];
  const t = (w[0] * v[1] - w[1] * v[0]) / denom;
  const u = (w[0] * unit[1] - w[1] * unit[0]) / denom;
  if (u >= -1e-9 && u <= 1 + 1e-9 && t > 0) return t;
  return null;
}

export interface FilletOutcome {
  a: Record<string, unknown> | null;
  b: Record<string, unknown> | null;
}

/** FILLET with radius 0 joins two lines at their intersection. */
export function filletLines(a: StoredObject, b: StoredObject): FilletOutcome {
  if (a.type !== "line" || b.type !== "line") return { a: null, b: null };
  const as = a.geometry.start as Point;
  const ae = a.geometry.end as Point;
  const bs = b.geometry.start as Point;
  const be = b.geometry.end as Point;
  const p = segSegIntersect(as, ae, bs, be);
  if (!p) return { a: null, b: null };
  const keepA = Math.hypot(as[0] - p[0], as[1] - p[1]) <= Math.hypot(ae[0] - p[0], ae[1] - p[1]) ? as : ae;
  const keepB = Math.hypot(bs[0] - p[0], bs[1] - p[1]) <= Math.hypot(be[0] - p[0], be[1] - p[1]) ? bs : be;
  return {
    a: { start: keepA, end: p },
    b: { start: keepB, end: p },
  };
}

/** Dimensions measured by the published rules, on the server. */
export function dimensionMeasure(
  kind: string,
  args: Record<string, unknown>,
  objects: StoredObject[],
): { measurement: number; points: Point[]; location: Point; handle?: string } {
  const point = (v: unknown): Point => v as Point;
  switch (kind) {
    case "DIMLINEAR": {
      const first = point(args.first);
      const second = point(args.second);
      const location = point(args.location);
      const aboveBelow = location[1] >= Math.max(first[1], second[1]) || location[1] <= Math.min(first[1], second[1]);
      const leftRight = location[0] <= Math.min(first[0], second[0]) || location[0] >= Math.max(first[0], second[0]);
      const measurement = aboveBelow || !leftRight ? Math.abs(second[0] - first[0]) : Math.abs(second[1] - first[1]);
      return { measurement: round(measurement, 6), points: [first, second], location };
    }
    case "DIMALIGNED": {
      const first = point(args.first);
      const second = point(args.second);
      const location = point(args.location);
      return { measurement: round(Math.hypot(second[0] - first[0], second[1] - first[1]), 6), points: [first, second], location };
    }
    case "DIMRADIUS": {
      const handle = args.handle as string;
      const target = objects.find((o) => o.handle === handle);
      if (!target || (target.type !== "circle" && target.type !== "arc")) throw new Error("no-object");
      const location = point(args.location);
      const center = target.geometry.center as Point;
      const radius = target.geometry.radius as number;
      return { measurement: round(radius, 6), points: [center, arcPoint(center, radius, 0)], location, handle };
    }
    case "DIMANGULAR": {
      const firstHandle = args.first_handle as string;
      const secondHandle = args.second_handle as string;
      const location = point(args.location);
      const first = objects.find((o) => o.handle === firstHandle);
      const second = objects.find((o) => o.handle === secondHandle);
      if (!first || !second || first.type !== "line" || second.type !== "line") throw new Error("no-object");
      const vertex = segSegIntersect(
        first.geometry.start as Point,
        first.geometry.end as Point,
        second.geometry.start as Point,
        second.geometry.end as Point,
      );
      if (!vertex) throw new Error("no-object");
      const dirA: Point = directionOf(first, vertex);
      const dirB: Point = directionOf(second, vertex);
      const angleA = (Math.atan2(dirA[1], dirA[0]) * 180) / Math.PI;
      const angleB = (Math.atan2(dirB[1], dirB[0]) * 180) / Math.PI;
      let delta = angleB - angleA;
      while (delta < 0) delta += 360;
      while (delta >= 360) delta -= 360;
      let measurement = delta > 180 ? 360 - delta : delta;
      const loc: Point = [location[0] - vertex[0], location[1] - vertex[1]];
      const locAngle = (Math.atan2(loc[1], loc[0]) * 180) / Math.PI;
      const inReflex = angleBetween(locAngle, angleA, angleA + (delta > 180 ? 360 - delta : delta));
      if (delta > 180 && inReflex) measurement = 360 - delta;
      else if (delta > 180 && !inReflex) measurement = 360 - delta;
      return {
        measurement: round(measurement, 6),
        points: [vertex, vertex],
        location,
      };
    }
    default:
      throw new Error("no-dimension");
  }
}

function directionOf(line: StoredObject, vertex: Point): Point {
  const s = line.geometry.start as Point;
  const e = line.geometry.end as Point;
  const from = Math.hypot(s[0] - vertex[0], s[1] - vertex[1]) <= Math.hypot(e[0] - vertex[0], e[1] - vertex[1]) ? s : e;
  const len = Math.hypot(from[0] - vertex[0], from[1] - vertex[1]) || 1;
  return [(from[0] - vertex[0]) / len, (from[1] - vertex[1]) / len];
}

function angleBetween(target: number, start: number, end: number): boolean {
  let t = ((target % 360) + 360) % 360;
  let s = ((start % 360) + 360) % 360;
  let e = ((end % 360) + 360) % 360;
  if (e < s) e += 360;
  if (t < s) t += 360;
  return t >= s && t <= e;
}

export function dedupeTracePoints(points: Point[]): Point[] {
  return dedupePoints(points);
}
