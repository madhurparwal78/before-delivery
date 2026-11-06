// Plan geometry shared by the server and the browser. Coordinates are plan fractions
// with at most four decimals, so every comparison runs exactly in integer units of
// 1/10000 (doubled where a midpoint is needed). Rooms are rectilinear outlines.

export interface Point {
  x: number;
  y: number;
}

export type Outline = Point[];

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Unit = [number, number];

const SCALE = 10000;

/** A finite number from 0 to 1, both ends allowed. */
export function isPlanFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** True when the number has at most four decimal places. */
export function hasFourDecimals(v: number): boolean {
  return Math.abs(v * SCALE - Math.round(v * SCALE)) < 1e-6;
}

/** Rounds to the nearest 0.0001, halves up. */
export function roundPin(v: number): number {
  return Math.round(Number((v * SCALE).toPrecision(12))) / SCALE;
}

function units(o: Outline, factor = 1): Unit[] {
  return o.map((p) => [Math.round(p.x * SCALE) * factor, Math.round(p.y * SCALE) * factor]);
}

function edges(poly: readonly Unit[]): [Unit, Unit][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length] as Unit]);
}

function onSegment([ax, ay]: Unit, [bx, by]: Unit, x: number, y: number): boolean {
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by);
}

/** Rectilinear point test in the polygon's own units; boundary points count as inside. */
function containsUnits(poly: readonly Unit[], x: number, y: number): boolean {
  let inside = false;
  for (const [a, b] of edges(poly)) {
    if (onSegment(a, b, x, y)) return true;
    if (a[0] === b[0] && a[0] > x && y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])) inside = !inside;
  }
  return inside;
}

type OutlineCheck = { ok: true; outline: Outline } | { ok: false; message: string };

/** Validates a room outline: 4 to 12 corners, alternating straight edges, simple. */
export function checkOutline(raw: unknown): OutlineCheck {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > 12) {
    return { ok: false, message: "An outline needs 4 to 12 corners." };
  }
  const outline: Outline = [];
  for (const corner of raw as unknown[]) {
    const c = corner as Partial<Point> | null;
    if (
      typeof c !== "object" ||
      c === null ||
      !isPlanFraction(c.x) ||
      !isPlanFraction(c.y) ||
      !hasFourDecimals(c.x) ||
      !hasFourDecimals(c.y)
    ) {
      return { ok: false, message: "Use plan fractions from 0 to 1 with up to four decimals." };
    }
    outline.push({ x: roundPin(c.x), y: roundPin(c.y) });
  }
  const sides = edges(units(outline));
  const kinds = sides.map(([[ax, ay], [bx, by]]) => (ay === by ? (ax === bx ? "zero" : "h") : ax === bx ? "v" : "slant"));
  if (kinds.includes("zero")) return { ok: false, message: "Corners must not repeat: every edge needs some length." };
  const alternates = kinds.every((k, i) => k !== "slant" && k !== kinds[(i + 1) % kinds.length]);
  if (!alternates) {
    return { ok: false, message: "Each edge must run straight across or straight down, turning at every corner." };
  }
  const n = sides.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [[ax, ay], [bx, by]] = sides[i] as [Unit, Unit];
      const [[cx, cy], [dx, dy]] = sides[j] as [Unit, Unit];
      const touch =
        Math.max(ax, bx) >= Math.min(cx, dx) &&
        Math.max(cx, dx) >= Math.min(ax, bx) &&
        Math.max(ay, by) >= Math.min(cy, dy) &&
        Math.max(cy, dy) >= Math.min(ay, by);
      if (touch) return { ok: false, message: "Edges can't cross or touch each other." };
    }
  }
  return { ok: true, outline };
}

function distinct(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** True when the interiors share positive area; touching edges or corners do not count. */
export function outlinesOverlap(a: Outline, b: Outline): boolean {
  const pa = units(a, 2);
  const pb = units(b, 2);
  const xs = distinct([...pa, ...pb].map((p) => p[0]));
  const ys = distinct([...pa, ...pb].map((p) => p[1]));
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
      if (containsUnits(pa, cx, cy) && containsUnits(pb, cx, cy)) return true;
    }
  }
  return false;
}

/** The smallest axis-aligned box around the corners. */
export function outlineBounds(o: Outline): Bounds {
  const u = units(o);
  const xs = u.map((p) => p[0]);
  const ys = u.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x / SCALE, y: y / SCALE, w: (Math.max(...xs) - x) / SCALE, h: (Math.max(...ys) - y) / SCALE };
}

/** Midpoint of the widest (then leftmost) segment of the horizontal centre line inside the room. */
export function outlineAnchor(o: Outline): Point {
  const poly = units(o, 2);
  const ys = poly.map((p) => p[1]);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs = distinct(poly.map((p) => p[0]));
  // Closed segments: adjacent inside spans along the line merge into one.
  const segments: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const left = xs[i] as number;
    const right = xs[i + 1] as number;
    if (!containsUnits(poly, (left + right) / 2, cy)) continue;
    const last = segments.at(-1);
    if (last && last[1] === left) last[1] = right;
    else segments.push([left, right]);
  }
  // Scanning left to right, a strictly wider segment wins, so ties keep the leftmost.
  let [l, r] = segments[0] ?? [0, 0];
  for (const [a, b] of segments) if (b - a > r - l) [l, r] = [a, b];
  return { x: (l + r) / (4 * SCALE), y: cy / (2 * SCALE) };
}

/** True when the point lies in the closed polygon, boundary included. */
export function outlineContains(o: Outline, p: Point): boolean {
  return containsUnits(units(o), Math.round(p.x * SCALE), Math.round(p.y * SCALE));
}

/**
 * The room a pin decides. `rooms` are in creation order; on a shared edge the first
 * preferred id among the containing rooms wins, then the earliest-created one.
 */
export function roomForPin<R extends { id: string; outline: Outline }>(
  rooms: readonly R[],
  pin: Point,
  preferred: readonly (string | null | undefined)[],
): R | null {
  const containing = rooms.filter((room) => outlineContains(room.outline, pin));
  for (const id of preferred) {
    const room = id == null ? undefined : containing.find((r) => r.id === id);
    if (room) return room;
  }
  return containing[0] ?? null;
}

export type RefPair = { old: Point; new: Point };

/** An affine transform, kept as the three reference pairs that define it. */
export interface Affine {
  pairs: [RefPair, RefPair, RefPair];
}

/** The transform that leaves every point where it is. */
export const IDENTITY: Affine = {
  pairs: [
    { old: { x: 0, y: 0 }, new: { x: 0, y: 0 } },
    { old: { x: 1, y: 0 }, new: { x: 1, y: 0 } },
    { old: { x: 0, y: 1 }, new: { x: 0, y: 1 } },
  ],
};

const big = (v: number): bigint => BigInt(Math.round(v * SCALE));

type Triangle = [bigint, bigint, bigint, bigint, bigint, bigint];

function oldCorners([p1, p2, p3]: readonly RefPair[]): Triangle | null {
  if (!p1 || !p2 || !p3) return null;
  return [big(p1.old.x), big(p1.old.y), big(p2.old.x), big(p2.old.y), big(p3.old.x), big(p3.old.y)];
}

/** Twice the old triangle's signed area, in square units. */
function determinant([x1, y1, x2, y2, x3, y3]: Triangle): bigint {
  return (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
}

/** Solves the transform from three pairs; null when the old points are (nearly) collinear. */
export function solveAffine(pairs: readonly RefPair[]): Affine | null {
  const corners = pairs.length === 3 ? oldCorners(pairs) : null;
  if (!corners) return null;
  const d = determinant(corners);
  // |twice the area| below 0.000001 in plan fractions is below 100 square units.
  if ((d < 0n ? -d : d) < 100n) return null;
  const copy = (p: Point): Point => ({ x: roundPin(p.x), y: roundPin(p.y) });
  const [a, b, c] = pairs as [RefPair, RefPair, RefPair];
  return { pairs: [a, b, c].map((p) => ({ old: copy(p.old), new: copy(p.new) })) as Affine["pairs"] };
}

/** Rounds n/d to the nearest integer, halves up (d > 0). */
function roundHalfUp(n: bigint, d: bigint): bigint {
  const twice = 2n * n + d;
  const q = twice / (2n * d);
  return twice % (2n * d) !== 0n && twice < 0n ? q - 1n : q;
}

/** Maps a point exactly, then rounds each coordinate to 0.0001, halves up. */
export function applyAffine(t: Affine, p: Point): Point {
  const [p1, p2, p3] = t.pairs;
  const corners: Triangle = [big(p1.old.x), big(p1.old.y), big(p2.old.x), big(p2.old.y), big(p3.old.x), big(p3.old.y)];
  const [x1, y1, x2, y2, x3, y3] = corners;
  const [x, y] = [big(p.x), big(p.y)];
  let d = determinant(corners);
  let n2 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1);
  let n3 = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
  if (d < 0n) [d, n2, n3] = [-d, -n2, -n3];
  const axis = (k: "x" | "y"): number => {
    const q1 = big(p1.new[k]);
    const num = q1 * d + n2 * (big(p2.new[k]) - q1) + n3 * (big(p3.new[k]) - q1);
    return Number(roundHalfUp(num, d)) / SCALE;
  };
  return { x: axis("x"), y: axis("y") };
}

/** The stored form of a transform. */
export function affineToJson(t: Affine): unknown {
  return t.pairs;
}

/** Reads a stored transform back; anything unreadable is the identity. */
export function affineFromJson(raw: unknown): Affine {
  if (!Array.isArray(raw) || raw.length !== 3) return IDENTITY;
  const point = (v: unknown): v is Point =>
    typeof v === "object" && v !== null && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);
  const ok = (raw as unknown[]).every(
    (p) => typeof p === "object" && p !== null && point((p as RefPair).old) && point((p as RefPair).new),
  );
  return ok ? (solveAffine(raw as RefPair[]) ?? IDENTITY) : IDENTITY;
}
