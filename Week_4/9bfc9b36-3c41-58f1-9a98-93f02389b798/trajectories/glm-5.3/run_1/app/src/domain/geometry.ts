export type Pt = readonly [number, number];

/**
 * Two simple outlines overlap when their interiors share an area above zero. Touching at a
 * vertex or along an edge, including a shared slanted edge, is allowed.
 */
export function outlinesOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  // 1. Some edge pair properly crosses at a point interior to both segments.
  const ea = edgesOf(a);
  const eb = edgesOf(b);
  for (const [p, q] of ea) {
    for (const [r, s] of eb) {
      if (segmentsProperlyCross(p, q, r, s)) return true;
    }
  }
  // 2. No proper crossing, but one outline may still hold part of the other. Every probe point
  //    is taken from a rich set (vertices, edge midpoints and several triangle centroids), and
  //    any probe that lies on the other outline's boundary is simply skipped, so a touching
  //    edge never fools the test and a partial covering never escapes it.
  const probes = probePoints(a);
  for (const probe of probes) {
    if (pointInside(b, probe)) return true;
  }
  for (const probe of probePoints(b)) {
    if (pointInside(a, probe)) return true;
  }
  return false;
}

/** Candidate interior points of an outline: vertices, edge midpoints, triangle centroids. */
function probePoints(outline: readonly Pt[]): [number, number][] {
  const out: [number, number][] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % n]!;
    out.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const r = outline[j]!;
        const s = outline[k]!;
        if (orient(p, q, r) === 0 && orient(p, q, s) === 0) continue;
        out.push([(p[0] + r[0] + s[0]) / 3, (p[1] + r[1] + s[1]) / 3]);
      }
    }
  }
  return out;
}

function edgesOf(outline: readonly Pt[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) out.push([outline[i]!, outline[(i + 1) % n]!]);
  return out;
}

/** Proper crossing: the segments cross at a point interior to both, in exact arithmetic. */
function segmentsProperlyCross(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d1 = orient(r, s, p);
  const d2 = orient(r, s, q);
  const d3 = orient(p, q, r);
  const d4 = orient(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Even-odd test that excludes boundary points first. */
function pointInside(outline: readonly Pt[], p: readonly [number, number]): boolean {
  if (onBoundary(outline, p)) return false;
  let inside = false;
  const n = outline.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = outline[i]![0];
    const yi = outline[i]![1];
    const xj = outline[j]![0];
    const yj = outline[j]![1];
    const intersects = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when p lies on an edge of the outline. */
function onBoundary(outline: readonly Pt[], p: readonly [number, number]): boolean {
  const n = outline.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = outline[j]!;
    const b = outline[i]!;
    const cross = orient(a, b, p);
    if (cross !== 0) continue;
    const withinX = p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]);
    const withinY = p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
    if (withinX && withinY) return true;
  }
  return false;
}

/** Shoelace area (unsigned) as an exact rational number. */
export function shoelaceArea(outline: readonly Pt[]): { num: number; den: number } {
  let num = 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = outline[i]!;
    const [x2, y2] = outline[(i + 1) % n]!;
    num += x1 * y2 - x2 * y1;
  }
  return { num: Math.abs(num), den: 2 };
}
