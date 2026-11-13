import type { DrawingObject, Point, Units } from "../shared/types.js";

export interface Viewport {
  /** Screen pixels per millimetre. */
  scale: number;
  /** Model point at the centre of the canvas. */
  centre: Point;
  /** The fitted scale, for zoom percentage. */
  fittedScale: number;
}

export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function extentsOf(objects: DrawingObject[]): { min: Point; max: Point } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (p: Point): void => {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  };
  for (const obj of objects) {
    switch (obj.type) {
      case "line":
        include(obj.start);
        include(obj.end);
        break;
      case "polyline":
      case "spline":
        for (const p of obj.type === "polyline" ? obj.vertices : obj.fit_points) include(p);
        break;
      case "circle":
        include([obj.center[0] - obj.radius, obj.center[1] - obj.radius]);
        include([obj.center[0] + obj.radius, obj.center[1] + obj.radius]);
        break;
      case "arc": {
        include([obj.center[0] - obj.radius, obj.center[1] - obj.radius]);
        include([obj.center[0] + obj.radius, obj.center[1] + obj.radius]);
        break;
      }
      case "mtext":
        include(obj.position);
        include([obj.position[0] + obj.width, obj.position[1]]);
        break;
      case "dimension":
        for (const p of obj.points) include(p);
        include(obj.location);
        break;
      case "insert":
        include(obj.position);
        break;
      case "revcloud":
        include(obj.first);
        include(obj.opposite);
        break;
    }
  }
  if (!Number.isFinite(minX)) {
    return { min: [0, 0], max: [10000, 7000] };
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

/** The fitted view: scale and centre per the published rule. */
export function fitViewport(objects: DrawingObject[], box: CanvasBox): Viewport {
  const { min, max } = extentsOf(objects);
  const w = Math.max(1, max[0] - min[0]);
  const h = Math.max(1, max[1] - min[1]);
  const scale = Math.min((0.8 * box.width) / w, (0.8 * box.height) / h);
  const centre: Point = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return { scale, centre, fittedScale: scale };
}

export function toScreen(p: Point, view: Viewport, box: CanvasBox): [number, number] {
  const x = box.left + box.width / 2 + (p[0] - view.centre[0]) * view.scale;
  const y = box.top + box.height / 2 - (p[1] - view.centre[1]) * view.scale;
  return [x, y];
}

export function toModel(x: number, y: number, view: Viewport, box: CanvasBox): Point {
  const mx = view.centre[0] + (x - (box.left + box.width / 2)) / view.scale;
  const my = view.centre[1] - (y - (box.top + box.height / 2)) / view.scale;
  return [mx, my];
}

export function zoomPercent(view: Viewport): number {
  return Math.round((view.scale / view.fittedScale) * 100);
}

export interface SnapCandidate {
  point: Point;
  kind: "endpoint" | "midpoint" | "center" | "intersection";
}

export function snapCandidates(
  objects: DrawingObject[],
  intersections: Point[],
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const obj of objects) {
    const snaps = obj.snaps;
    for (const p of snaps.endpoint) out.push({ point: p, kind: "endpoint" });
    for (const p of snaps.midpoint) out.push({ point: p, kind: "midpoint" });
    for (const p of snaps.center) out.push({ point: p, kind: "center" });
  }
  for (const p of intersections) out.push({ point: p, kind: "intersection" });
  return out;
}

const kindOrder: Array<SnapCandidate["kind"]> = ["endpoint", "midpoint", "center", "intersection"];

export function nearestSnap(
  candidates: SnapCandidate[],
  modelPoint: Point,
  apertureModel: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = Math.hypot(candidate.point[0] - modelPoint[0], candidate.point[1] - modelPoint[1]);
    if (dist > apertureModel) continue;
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = candidate;
    } else if (Math.abs(dist - bestDist) <= 1e-9 && best) {
      if (kindOrder.indexOf(candidate.kind) < kindOrder.indexOf(best.kind)) best = candidate;
    }
  }
  return best;
}

export function candidatesInAperture(
  candidates: SnapCandidate[],
  modelPoint: Point,
  apertureModel: number,
): SnapCandidate[] {
  const inAperture = candidates.filter(
    (c) => Math.hypot(c.point[0] - modelPoint[0], c.point[1] - modelPoint[1]) <= apertureModel,
  );
  const sorted = [...inAperture].sort((a, b) => {
    const ai = kindOrder.indexOf(a.kind);
    const bi = kindOrder.indexOf(b.kind);
    if (ai !== bi) return ai - bi;
    return (
      Math.hypot(a.point[0] - modelPoint[0], a.point[1] - modelPoint[1]) -
      Math.hypot(b.point[0] - modelPoint[0], b.point[1] - modelPoint[1])
    );
  });
  return sorted;
}

export function markerShape(kind: SnapCandidate["kind"]): string {
  switch (kind) {
    case "endpoint":
      return "square";
    case "midpoint":
      return "triangle";
    case "center":
      return "circle";
    case "intersection":
      return "x";
  }
}

export function markerLabel(kind: SnapCandidate["kind"]): string {
  switch (kind) {
    case "endpoint":
      return "Endpoint snap";
    case "midpoint":
      return "Midpoint snap";
    case "center":
      return "Center snap";
    case "intersection":
      return "Intersection snap";
  }
}

export function parseCoordinate(text: string, lastPoint: Point | null, units: Units): Point | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const factor = units === "m" ? 1000 : 1;
  const abs = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (abs) return [Number.parseFloat(abs[1]) * factor, Number.parseFloat(abs[2]) * factor];
  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1);
    const rel = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(rest);
    if (rel && lastPoint) {
      return [lastPoint[0] + Number.parseFloat(rel[1]) * factor, lastPoint[1] + Number.parseFloat(rel[2]) * factor];
    }
    const polar = /^(-?\d+(?:\.\d+)?)<(-?\d+(?:\.\d+)?)$/.exec(rest);
    if (polar && lastPoint) {
      const d = Number.parseFloat(polar[1]) * factor;
      const a = (Number.parseFloat(polar[2]) * Math.PI) / 180;
      return [lastPoint[0] + d * Math.cos(a), lastPoint[1] + d * Math.sin(a)];
    }
    return null;
  }
  return null;
}

export function applyOrtho(candidate: Point, last: Point | null): Point {
  if (!last) return candidate;
  const dx = Math.abs(candidate[0] - last[0]);
  const dy = Math.abs(candidate[1] - last[1]);
  return dx >= dy ? [candidate[0], last[1]] : [last[0], candidate[1]];
}

export function applyPolar(candidate: Point, last: Point | null): Point {
  if (!last) return candidate;
  const dx = candidate[0] - last[0];
  const dy = candidate[1] - last[1];
  const dist = Math.hypot(dx, dy);
  const angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) / 45) * 45;
  const rad = (angle * Math.PI) / 180;
  return [last[0] + dist * Math.cos(rad), last[1] + dist * Math.sin(rad)];
}

export function applyGrid(candidate: Point): Point {
  return [Math.round(candidate[0] / 100) * 100, Math.round(candidate[1] / 100) * 100];
}

export function objectPath(obj: DrawingObject): string {
  switch (obj.type) {
    case "line":
      return `M ${obj.start[0]} ${obj.start[1]} L ${obj.end[0]} ${obj.end[1]}`;
    case "polyline":
    case "spline": {
      const pts = obj.type === "polyline" ? obj.vertices : obj.fit_points;
      if (pts.length === 0) return "";
      const head = `M ${pts[0][0]} ${pts[0][1]}`;
      const rest = pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(" ");
      const close = obj.type === "polyline" && obj.closed ? " Z" : "";
      return `${head} ${rest}${close}`;
    }
    case "circle":
      return `M ${obj.center[0] - obj.radius} ${obj.center[1]} a ${obj.radius} ${obj.radius} 0 1 0 ${obj.radius * 2} 0 a ${obj.radius} ${obj.radius} 0 1 0 -${obj.radius * 2} 0`;
    case "arc": {
      const rad = (deg: number): [number, number] => [
        obj.center[0] + obj.radius * Math.cos((deg * Math.PI) / 180),
        obj.center[1] + obj.radius * Math.sin((deg * Math.PI) / 180),
      ];
      const s = rad(obj.start_angle);
      const e = rad(obj.end_angle);
      let sweep = ((obj.end_angle - obj.start_angle) % 360 + 360) % 360;
      if (sweep === 0) sweep = 360;
      const large = sweep > 180 ? 1 : 0;
      return `M ${s[0]} ${s[1]} A ${obj.radius} ${obj.radius} 0 ${large} 1 ${e[0]} ${e[1]}`;
    }
    case "revcloud": {
      const [x1, y1] = obj.first;
      const [x2, y2] = obj.opposite;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const step = 150;
      const parts: string[] = [];
      const arcsX = Math.max(1, Math.ceil(w / step));
      const arcsY = Math.max(1, Math.ceil(h / step));
      for (let i = 0; i < arcsX; i++) {
        parts.push(`M ${x1 + (i * w) / arcsX} ${y1} a ${(w / arcsX) / 2} ${(h / arcsY) / 2} 0 0 1 ${w / arcsX} 0`);
      }
      return parts.join(" ");
    }
    case "mtext":
      return `M ${obj.position[0]} ${obj.position[1] - obj.height / 2} h ${obj.width}`;
    case "dimension": {
      const mid: Point = [(obj.points[0][0] + obj.points[1][0]) / 2, (obj.points[0][1] + obj.points[1][1]) / 2];
      return `M ${obj.points[0][0]} ${obj.points[0][1]} L ${obj.points[1][0]} ${obj.points[1][1]}`;
    }
    case "insert":
      return `M ${obj.position[0]} ${obj.position[1]} h 50 v 50 h -50 Z`;
    default:
      return "";
  }
}

export function objectVertices(obj: DrawingObject): Point[] {
  switch (obj.type) {
    case "line":
      return [obj.start, obj.end];
    case "polyline":
      return obj.vertices;
    case "spline":
      return obj.fit_points;
    case "circle":
      return [obj.center];
    case "arc":
      return [obj.center];
    case "mtext":
      return [obj.position];
    case "dimension":
      return [...obj.points, obj.location];
    case "insert":
      return [obj.position];
    case "revcloud":
      return [obj.first, obj.opposite];
    default:
      return [];
  }
}

export function distanceTo(obj: DrawingObject, p: Point): number {
  const seg = (a: Point, b: Point): number => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  };
  switch (obj.type) {
    case "line":
      return seg(obj.start, obj.end);
    case "polyline": {
      let best = Infinity;
      for (let i = 0; i + 1 < obj.vertices.length; i++) best = Math.min(best, seg(obj.vertices[i], obj.vertices[i + 1]));
      if (obj.closed && obj.vertices.length > 1) best = Math.min(best, seg(obj.vertices[obj.vertices.length - 1], obj.vertices[0]));
      return best;
    }
    case "spline": {
      let best = Infinity;
      for (let i = 0; i + 1 < obj.fit_points.length; i++) best = Math.min(best, seg(obj.fit_points[i], obj.fit_points[i + 1]));
      return best;
    }
    case "circle":
      return Math.abs(Math.hypot(p[0] - obj.center[0], p[1] - obj.center[1]) - obj.radius);
    case "arc":
      return Math.abs(Math.hypot(p[0] - obj.center[0], p[1] - obj.center[1]) - obj.radius);
    case "mtext":
      return seg(obj.position, [obj.position[0] + obj.width, obj.position[1]]);
    case "dimension": {
      const mid: Point = [(obj.points[0][0] + obj.points[1][0]) / 2, (obj.points[0][1] + obj.points[1][1]) / 2];
      return Math.min(seg(obj.points[0], obj.location), seg(obj.points[1], obj.location), seg(mid, obj.location));
    }
    case "insert":
      return Math.hypot(p[0] - obj.position[0], p[1] - obj.position[1]);
    case "revcloud": {
      const corners: Point[] = [obj.first, [obj.opposite[0], obj.first[1]], obj.opposite, [obj.first[0], obj.opposite[1]]];
      let best = Infinity;
      for (let i = 0; i < 4; i++) best = Math.min(best, seg(corners[i], corners[(i + 1) % 4]));
      return best;
    }
    default:
      return Infinity;
  }
}

export type { Point } from "../shared/types.js";
