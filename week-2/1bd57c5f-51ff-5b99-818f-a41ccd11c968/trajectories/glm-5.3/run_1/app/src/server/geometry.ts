import type { Outline, Pt } from "../shared/types.js";

export type Bounds = { x: number; y: number; w: number; h: number };

export function boundsOf(outline: Outline): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of outline) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function isValidOutline(outline: unknown): outline is Outline {
  if (!Array.isArray(outline)) return false;
  if (outline.length < 4 || outline.length > 12) return false;
  const pts: Pt[] = [];
  for (const c of outline) {
    if (typeof c !== "object" || c === null) return false;
    const o = c as Record<string, unknown>;
    if (typeof o.x !== "number" || typeof o.y !== "number") return false;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return false;
    if (o.x < 0 || o.x > 1 || o.y < 0 || o.y > 1) return false;
    if (decimalsOf(o.x) > 4 || decimalsOf(o.y) > 4) return false;
    pts.push({ x: o.x, y: o.y });
  }
  // Edges alternate between horizontal and vertical, no edge has zero length.
  const n = pts.length;
  const firstIsHorizontal = pts[0].y === pts[1].y;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const horizontal = a.y === b.y;
    if (horizontal !== ((i % 2 === 0) === firstIsHorizontal)) return false;
    if (horizontal) {
      if (a.x === b.x) return false;
    } else {
      if (a.y === b.y) return false;
    }
  }
  // Simple polygon: non-adjacent edges share no point.
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (edgesSharePoint(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

function decimalsOf(v: number): number {
  const s = v.toString();
  const dot = s.indexOf(".");
  if (dot === -1) return 0;
  return s.length - dot - 1;
}

function segmentsShareAxisPoint(a1: number, a2: number, b1: number, b2: number): boolean {
  const lo1 = Math.min(a1, a2), hi1 = Math.max(a1, a2);
  const lo2 = Math.min(b1, b2), hi2 = Math.max(b1, b2);
  return lo1 <= hi2 && lo2 <= hi1;
}

function segsSharePoint(ax1: number, ay1: number, ax2: number, ay2: number, bx1: number, by1: number, bx2: number, by2: number): boolean {
  // For axis-parallel segments: overlap on both axes.
  return segmentsShareAxisPoint(ax1, ax2, bx1, bx2) && segmentsShareAxisPoint(ay1, ay2, by1, by2);
}

function edgesSharePoint(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  return segsSharePoint(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y);
}

export function pointInOutline(pt: Pt, outline: Outline): boolean {
  // Boundary counts as inside (explicit check against every edge), then the
  // standard even-odd ray cast for the interior.
  const eps = 1e-9;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if (a.x === b.x) {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      if (pt.x === a.x && pt.y >= lo - eps && pt.y <= hi + eps) return true;
    } else {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      if (pt.y === a.y && pt.x >= lo - eps && pt.x <= hi + eps) return true;
    }
  }
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < a.x) inside = !inside;
  }
  return inside;
}

export function polygonsOverlap(a: Outline, b: Outline): boolean {
  // Rectilinear polygons: interiors share area. We sample the arrangement of
  // all x and y coordinates of both polygons' corners and test cell midpoints,
  // which is exact for rectilinear geometry.
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const c of [...a, ...b]) { xs.add(c.x); ys.add(c.y); }
  const xv = [...xs].sort((p, q) => p - q);
  const yv = [...ys].sort((p, q) => p - q);
  for (let i = 0; i + 1 < xv.length; i++) {
    for (let j = 0; j + 1 < yv.length; j++) {
      const mid = { x: (xv[i] + xv[i + 1]) / 2, y: (yv[j] + yv[j + 1]) / 2 };
      if (cellNonDegenerate(xv[i], xv[i + 1], yv[j], yv[j + 1]) && pointInOutline(mid, a) && pointInOutline(mid, b)) return true;
    }
  }
  return false;
}

function cellNonDegenerate(x1: number, x2: number, y1: number, y2: number): boolean {
  return x1 !== x2 && y1 !== y2;
}

/** Rooms containing a point, in creation order given by the input array. */
export function roomsContaining(pt: Pt, rooms: { id: string; outline: Outline }[]): { id: string; outline: Outline }[] {
  return rooms.filter((r) => pointInOutline(pt, r.outline));
}

/** The anchor: the midpoint of the widest closed segment of the horizontal line
 *  through the bounds' vertical centre, leftmost on ties. */
export function anchorOf(outline: Outline): Pt {
  const b = boundsOf(outline);
  const y = b.y + b.h / 2;
  const xs = Array.from(new Set<number>(outline.map((c) => c.x))).sort((p, q) => p - q);
  const intervals: { lo: number; hi: number }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    if (pointInOutline({ x: mid, y }, outline)) intervals.push({ lo: xs[i], hi: xs[i + 1] });
  }
  let best: { lo: number; hi: number } | null = null;
  const merged: { lo: number; hi: number }[] = [];
  for (const seg of intervals) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.hi === seg.lo) last.hi = seg.hi;
    else merged.push({ ...seg });
  }
  for (const seg of merged) {
    if (best === null || seg.hi - seg.lo > best.hi - best.lo) best = seg;
  }
  if (best === null) {
    // The centre line touches the polygon only at points (a degenerate case):
    // fall back to the widest vertical extent at the bounds' centre.
    return { x: b.x + b.w / 2, y };
  }
  return { x: (best.lo + best.hi) / 2, y };
}

/** Solves the affine transform mapping each old point to its new point. */
export function solveAffine(olds: Pt[], news: Pt[]): { a: number[][]; t: Pt } | null {
  const [o1, o2, o3] = olds;
  const [n1, n2, n3] = news;
  const d = (o2.x - o1.x) * (o3.y - o1.y) - (o3.x - o1.x) * (o2.y - o1.y);
  if (Math.abs(d) < 1e-12) return null;
  const rhsX = [n1.x - o1.x, n2.x - o1.x, n3.x - o1.x];
  const rhsY = [n1.y - o1.y, n2.y - o1.y, n3.y - o1.y];
  const sx = [1, o2.x - o1.x, o3.x - o1.x];
  const sy = [1, o2.y - o1.y, o3.y - o1.y];
  // Solve 3x3 systems [ sx ; basis ] for A columns and translation.
  const a11 = ((rhsX[1] * (o3.y - o1.y) - rhsX[2] * (o2.y - o1.y))) / d;
  const a12 = ((rhsX[2] * (o2.x - o1.x) - rhsX[1] * (o3.x - o1.x))) / d;
  const a21 = ((rhsY[1] * (o3.y - o1.y) - rhsY[2] * (o2.y - o1.y))) / d;
  const a22 = ((rhsY[2] * (o2.x - o1.x) - rhsY[1] * (o3.x - o1.x))) / d;
  const tx = n1.x - (a11 * o1.x + a12 * o1.y);
  const ty = n1.y - (a21 * o1.x + a22 * o1.y);
  return { a: [[a11, a12], [a21, a22]], t: { x: tx, y: ty } };
}

export function applyAffine(tr: { a: number[][]; t: Pt }, p: Pt): Pt {
  return {
    x: tr.a[0][0] * p.x + tr.a[0][1] * p.y + tr.t.x,
    y: tr.a[1][0] * p.x + tr.a[1][1] * p.y + tr.t.y,
  };
}

export function twiceTriangleArea(points: Pt[]): number {
  const [p1, p2, p3] = points;
  return Math.abs((p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y));
}

/** Rounds a coordinate to the nearest 0.0001, halves up. */
export function roundPin(v: number): number {
  return Math.round((v + 1e-12) * 10000) / 10000;
}

export function pinEqual(a: Pt | null, b: Pt | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y;
}
