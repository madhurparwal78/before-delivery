// Deterministic generators for the landing page's drawn assets: nothing here is stored art, every line is computed.
export type Point = readonly [number, number];

/** Small seeded generator so every visit draws the same lines. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (n: number): number => Math.round(n * 10) / 10;
const pt = (p: Point): string => `${round(p[0])} ${round(p[1])}`;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpPoint = (a: Point, b: Point, t: number): Point => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

export const line = (a: Point, b: Point): string => `M${pt(a)}L${pt(b)}`;
export const quad = (a: Point, c: Point, b: Point): string => `M${pt(a)}Q${pt(c)} ${pt(b)}`;
export const polyline = (points: readonly Point[]): string => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(p)}`).join('');

export const closed = (points: readonly Point[]): string => `${polyline(points)}Z`;

/** Point on a quadratic bezier at parameter t. */
export function quadAt(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** The same curve pushed sideways by `distance` along its chord normal (an offset-curve family member). */
export function offsetQuad(a: Point, c: Point, b: Point, distance: number): [Point, Point, Point] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const shift: Point = [(-dy / length) * distance, (dx / length) * distance];
  return [[a[0] + shift[0], a[1] + shift[1]], [c[0] + shift[0], c[1] + shift[1]], [b[0] + shift[0], b[1] + shift[1]]];
}

/** Moves every side of a polygon inward by `distance` and rejoins the sides at their intersections (a mitred offset). */
export function offsetPolygon(points: readonly Point[], distance: number): Point[] {
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length] as Point;
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0);
  const inward = area > 0 ? 1 : -1;
  const sides = points.map((p, i) => {
    const q = points[(i + 1) % points.length] as Point;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const dir: Point = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
    const normal: Point = [-dir[1] * inward, dir[0] * inward];
    return { from: [p[0] + normal[0] * distance, p[1] + normal[1] * distance] as Point, dir };
  });
  return sides.map((side, i) => {
    const prev = sides[(i + sides.length - 1) % sides.length] as (typeof sides)[number];
    const cross = prev.dir[0] * side.dir[1] - prev.dir[1] * side.dir[0];
    const t = ((side.from[0] - prev.from[0]) * side.dir[1] - (side.from[1] - prev.from[1]) * side.dir[0]) / (cross || 1);
    return [prev.from[0] + prev.dir[0] * t, prev.from[1] + prev.dir[1] * t];
  });
}

/** A line to draw, with the point where its grip pops (omitted: no grip). */
export interface Stroke {
  d: string;
  grip?: Point;
}

