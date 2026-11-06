// Site-grid geometry in metres: (easting, northing) positions, convex polygons and chords.

export interface Position {
  easting: number;
  northing: number;
}

export type Vec = [number, number];

export const vec = (p: Position): Vec => [p.easting, p.northing];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];

/** Along-line (sin a, cos a) and across-line (cos a, −sin a) unit vectors for azimuth `a` degrees. */
export function directions(azimuthDeg: number): { along: Vec; across: Vec } {
  const a = (azimuthDeg * Math.PI) / 180;
  return { along: [Math.sin(a), Math.cos(a)], across: [Math.cos(a), -Math.sin(a)] };
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function signedArea(points: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Convex, with non-zero area, no repeated vertex and a single turn around its interior. */
export function isConvex(points: Vec[]): boolean {
  const n = points.length;
  if (n < 3 || Math.abs(signedArea(points)) < 1e-9) return false;
  const seen = new Set(points.map(([x, y]) => `${x},${y}`));
  if (seen.size !== n) return false;
  let sign = 0;
  let turning = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = points[(i + 2) % n];
    const z = cross(a, b, c);
    if (Math.abs(z) > 1e-9) {
      const s = Math.sign(z);
      if (sign && s !== sign) return false;
      sign = s;
    }
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = h2 - h1;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    turning += d;
  }
  return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6;
}

/** Inside a convex polygon or on its edge. */
export function insideConvex(points: Vec[], p: Vec, tolerance = 1e-9): boolean {
  const orientation = Math.sign(signedArea(points));
  for (let i = 0; i < points.length; i++) {
    const z = cross(points[i], points[(i + 1) % points.length], p);
    if (z * orientation < -tolerance) return false;
  }
  return true;
}

/**
 * The chord of a convex polygon where dot(p, normal) = value, as a range of dot(p, run) values.
 * Interpolating the run coordinate (not the point) keeps axis-aligned ends exact.
 */
export function chordRange(points: Vec[], normal: Vec, run: Vec, value: number): [number, number] | null {
  const found: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const fp = dot(p, normal) - value;
    const fq = dot(q, normal) - value;
    if (Math.abs(fp) < 1e-9) found.push(dot(p, run));
    else if (fp * fq < 0 && Math.abs(fq) >= 1e-9) {
      const k = fp / (fp - fq);
      found.push(dot(p, run) + (dot(q, run) - dot(p, run)) * k);
    }
  }
  if (!found.length) return null;
  return [Math.min(...found), Math.max(...found)];
}

/** The point whose normal coordinate is `value` and run coordinate `t`. */
export function pointAt(normal: Vec, run: Vec, value: number, t: number): Position {
  return { easting: normal[0] * value + run[0] * t, northing: normal[1] * value + run[1] * t };
}

export function distance(a: Position, b: Position): number {
  return Math.hypot(b.easting - a.easting, b.northing - a.northing);
}
