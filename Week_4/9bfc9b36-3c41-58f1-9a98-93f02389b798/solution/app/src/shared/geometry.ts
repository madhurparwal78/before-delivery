/** Sail areas, crosscut panel construction, placement, overlap and the first-fit search, all in exact integer arithmetic. */
import type { Outline } from "./types.js";
import { roundDiv } from "./units.js";

type Point = [number, number];

const SCALE = 10n ** 40n;

function sqrtBig(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** Round a non-negative fixed-point value (scaled by SCALE) to a whole number, half away from zero. */
function roundScaled(value: bigint): number {
  return Number((value * 2n + SCALE) / (2n * SCALE));
}

export function foretriangleArea(i: number, j: number): number {
  return roundDiv(i * j, 2);
}

export function mainsailArea(p: number, e: number, roachPermille: number): number {
  return roundDiv(p * e * roachPermille, 2000);
}

export function headsailArea(lp: number, ll: number): number {
  return roundDiv(lp * ll, 2);
}

export function roachText(roachPermille: number): string {
  return `${Math.trunc(roachPermille / 1000)}.${String(roachPermille % 1000).padStart(3, "0")}`;
}

interface BuiltPanel {
  number: number;
  outline: Outline;
  length_mm: number;
  width_mm: number;
  area_mm2: number;
}

/** The crosscut panels of a right-triangle sail: perpendicular to the leech, at spacing w. */
export function buildPanels(luff: number, foot: number, spacing: number): BuiltPanel[] {
  const L = BigInt(luff);
  const F = BigInt(foot);
  const w = BigInt(spacing);
  const leech = sqrtBig((F * F + L * L) * SCALE * SCALE);
  const sT = (F * F * SCALE * SCALE) / leech;
  const vT = (F * L * SCALE * SCALE) / leech;
  const depth = (s: bigint): bigint => (s <= sT ? (L * s) / F : (F * (leech - s)) / L);
  const count = Number((leech + w * SCALE - 1n) / (w * SCALE));
  const panels: BuiltPanel[] = [];
  for (let k = 1; k <= count; k++) {
    const a = BigInt(k - 1) * w * SCALE;
    const kb = BigInt(k) * w * SCALE;
    const b = kb < leech ? kb : leech;
    const vertices: [bigint, bigint][] = [[a, 0n], [b, 0n], [b, depth(b)]];
    if (a < sT && sT < b) vertices.push([sT, vT]);
    vertices.push([a, depth(a)]);
    const outline: Outline = [];
    for (const [s, v] of vertices) {
      const point: Point = [roundScaled(v), roundScaled(s - a)];
      const last = outline[outline.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) outline.push(point);
    }
    const first = outline[0];
    const tail = outline[outline.length - 1];
    if (outline.length > 1 && first && tail && first[0] === tail[0] && first[1] === tail[1]) outline.pop();
    panels.push({
      number: k,
      outline,
      length_mm: Math.max(...outline.map((p) => p[0])),
      width_mm: Math.max(...outline.map((p) => p[1])),
      area_mm2: shoelaceArea(outline),
    });
  }
  return panels;
}

function shoelaceArea(outline: Outline): number {
  let twice = 0;
  for (let index = 0; index < outline.length; index++) {
    const [x1, y1] = outline[index]!;
    const [x2, y2] = outline[(index + 1) % outline.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return roundDiv(Math.abs(twice), 2);
}

interface PanelShape {
  outline: Outline;
  length_mm: number;
  width_mm: number;
}

/** The panel's outline placed on the claim frame at (x, y), turned 0 or 180 degrees. */
export function placeOutline(panel: PanelShape, x: number, y: number, rotation: 0 | 180): Outline {
  return panel.outline.map(([px, py]) =>
    rotation === 180 ? [panel.length_mm - px + x, panel.width_mm - py + y] : [px + x, py + y],
  );
}

export function outlineExtent(outline: Outline): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function counterClockwise(outline: Outline): Point[] {
  let twice = 0;
  for (let index = 0; index < outline.length; index++) {
    const [x1, y1] = outline[index]!;
    const [x2, y2] = outline[(index + 1) % outline.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return twice < 0 ? [...outline].reverse() : [...outline];
}

/** Ear clipping of a simple polygon into triangles with exact integer tests. */
function triangulate(outline: Outline): Point[][] {
  const ring = counterClockwise(outline);
  const triangles: Point[][] = [];
  let guard = ring.length * ring.length;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let index = 0; index < ring.length; index++) {
      const previous = ring[(index + ring.length - 1) % ring.length]!;
      const current = ring[index]!;
      const next = ring[(index + 1) % ring.length]!;
      const turn = cross(previous, current, next);
      if (turn === 0) {
        ring.splice(index, 1);
        clipped = true;
        break;
      }
      if (turn < 0) continue;
      const blocked = ring.some(
        (candidate) =>
          candidate !== previous &&
          candidate !== current &&
          candidate !== next &&
          cross(previous, current, candidate) >= 0 &&
          cross(current, next, candidate) >= 0 &&
          cross(next, previous, candidate) >= 0,
      );
      if (blocked) continue;
      triangles.push([previous, current, next]);
      ring.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (ring.length === 3 && cross(ring[0]!, ring[1]!, ring[2]!) !== 0) triangles.push(ring);
  return triangles;
}

function separated(a: Point[], b: Point[]): boolean {
  for (const triangle of [a, b]) {
    for (let index = 0; index < 3; index++) {
      const p = triangle[index]!;
      const q = triangle[(index + 1) % 3]!;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      const project = (point: Point) => point[0] * nx + point[1] * ny;
      const aValues = a.map(project);
      const bValues = b.map(project);
      if (Math.max(...aValues) <= Math.min(...bValues) || Math.max(...bValues) <= Math.min(...aValues)) return true;
    }
  }
  return false;
}

/** Interiors that share an area above zero overlap; touching at a vertex or along an edge does not. */
export function outlinesOverlap(a: Outline, b: Outline): boolean {
  const boxA = outlineExtent(a);
  const boxB = outlineExtent(b);
  if (boxA.maxX <= boxB.minX || boxB.maxX <= boxA.minX || boxA.maxY <= boxB.minY || boxB.maxY <= boxA.minY) return false;
  const trianglesB = triangulate(b);
  return triangulate(a).some((ta) => trianglesB.some((tb) => !separated(ta, tb)));
}

interface Fraction {
  n: number;
  d: number;
}

/** The open interval of x offsets at which triangle `moving` (shifted along x) overlaps triangle `fixed`, or null. */
function forbiddenInterval(fixed: Point[], moving: Point[]): { low: Fraction; high: Fraction } | null {
  const differences: Point[] = [];
  for (const q of fixed) for (const p of moving) differences.push([q[0] - p[0], q[1] - p[1]]);
  const hull = convexHull(differences);
  if (hull.length < 3) return null;
  const ys = hull.map((p) => p[1]);
  if (!(Math.min(...ys) < 0 && Math.max(...ys) > 0)) return null;
  const crossings: Fraction[] = [];
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index]!;
    const b = hull[(index + 1) % hull.length]!;
    if ((a[1] < 0 && b[1] > 0) || (a[1] > 0 && b[1] < 0)) {
      const d = b[1] - a[1];
      const n = a[0] * d + (b[0] - a[0]) * (0 - a[1]);
      crossings.push(d > 0 ? { n, d } : { n: -n, d: -d });
    } else if (a[1] === 0) {
      crossings.push({ n: a[0], d: 1 });
    }
  }
  if (crossings.length < 2) return null;
  crossings.sort((p, q) => p.n * q.d - q.n * p.d);
  return { low: crossings[0]!, high: crossings[crossings.length - 1]! };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const unique = sorted.filter((p, index) => index === 0 || p[0] !== sorted[index - 1]![0] || p[1] !== sorted[index - 1]![1]);
  if (unique.length < 3) return unique;
  const lower: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** The smallest whole-mm x, with y at 0, where the turned panel lies inside the claim and clear of every laid outline. */
function firstFitX(panel: PanelShape, rotation: 0 | 180, claimLength: number, usableWidth: number, laid: Outline[]): number | null {
  if (panel.length_mm > claimLength || panel.width_mm > usableWidth) return null;
  const turned = placeOutline(panel, 0, 0, rotation);
  const movingTriangles = triangulate(turned);
  const intervals: { low: Fraction; high: Fraction }[] = [];
  for (const other of laid) {
    for (const fixed of triangulate(other)) {
      for (const moving of movingTriangles) {
        const interval = forbiddenInterval(fixed, moving);
        if (interval) intervals.push(interval);
      }
    }
  }
  let x = 0;
  for (let moved = true; moved; ) {
    moved = false;
    for (const { low, high } of intervals) {
      if (x * low.d > low.n && x * high.d < high.n) {
        x = Math.ceil(high.n / high.d);
        moved = true;
      }
    }
  }
  return x + panel.length_mm <= claimLength ? x : null;
}

export interface Placement {
  x_mm: number;
  y_mm: number;
  rotation: 0 | 180;
}

/** First fit over 0 and 180 degrees: the smaller x wins, a tie goes to 0. */
export function autoPosition(panel: PanelShape, claimLength: number, usableWidth: number, laid: Outline[]): Placement | null {
  const straight = firstFitX(panel, 0, claimLength, usableWidth, laid);
  const turned = firstFitX(panel, 180, claimLength, usableWidth, laid);
  if (straight !== null && (turned === null || straight <= turned)) return { x_mm: straight, y_mm: 0, rotation: 0 };
  if (turned !== null) return { x_mm: turned, y_mm: 0, rotation: 180 };
  return null;
}
