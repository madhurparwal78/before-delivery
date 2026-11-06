// Exact plane geometry for simple polygons on a project's local metre grid.
//
// The area of "boundary ∩ (P1 ∪ … ∪ Pk)" is found by vertical slabs: between consecutive x values
// where any vertex or edge crossing lies, every polygon's cross-section is a set of y-intervals whose
// ends move linearly in x, so the covered length is linear in x and the slab's area is its width times
// the covered length at its mid-line. All arithmetic is rational, so the result is exact.

import { Rational } from "./rational.js";

export type Point = readonly [number, number];
type Vertex = { x: Rational; y: Rational };
type Edge = { a: Vertex; b: Vertex };
type Interval = [Rational, Rational];

const HALF = Rational.of(1n, 2n);

function vertices(polygon: readonly Point[]): Vertex[] {
  return polygon.map(([x, y]) => ({ x: Rational.decimal(String(x)), y: Rational.decimal(String(y)) }));
}

function edgesOf(points: Vertex[]): Edge[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length]! }));
}

function sortUnique(values: Rational[]): Rational[] {
  const sorted = [...values].sort((p, q) => p.cmp(q));
  return sorted.filter((v, i) => i === 0 || v.cmp(sorted[i - 1]!) !== 0);
}

/** x of the point where two segments cross, when they cross at a single point. */
function crossingX(e: Edge, f: Edge): Rational | null {
  const dx1 = e.b.x.sub(e.a.x), dy1 = e.b.y.sub(e.a.y);
  const dx2 = f.b.x.sub(f.a.x), dy2 = f.b.y.sub(f.a.y);
  const denominator = dx1.mul(dy2).sub(dy1.mul(dx2));
  if (denominator.cmp(Rational.ZERO) === 0) return null;
  const ox = f.a.x.sub(e.a.x), oy = f.a.y.sub(e.a.y);
  const t = ox.mul(dy2).sub(oy.mul(dx2)).div(denominator);
  const u = ox.mul(dy1).sub(oy.mul(dx1)).div(denominator);
  const within = (r: Rational) => r.cmp(Rational.ZERO) >= 0 && r.cmp(Rational.of(1n)) <= 0;
  return within(t) && within(u) ? e.a.x.add(t.mul(dx1)) : null;
}

/** The even-odd y-intervals of a polygon on the vertical line at x (x lies on no vertex). */
function sectionAt(edges: Edge[], x: Rational): Interval[] {
  const ys: Rational[] = [];
  for (const { a, b } of edges) {
    const [lo, hi] = a.x.cmp(b.x) < 0 ? [a.x, b.x] : [b.x, a.x];
    if (lo.cmp(x) < 0 && x.cmp(hi) < 0) {
      ys.push(a.y.add(x.sub(a.x).mul(b.y.sub(a.y)).div(b.x.sub(a.x))));
    }
  }
  ys.sort((p, q) => p.cmp(q));
  const intervals: Interval[] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) intervals.push([ys[i]!, ys[i + 1]!]);
  return intervals;
}

function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((p, q) => p[0].cmp(q[0]));
  const merged: Interval[] = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo.cmp(last[1]) <= 0) {
      if (hi.cmp(last[1]) > 0) last[1] = hi;
    } else merged.push([lo, hi]);
  }
  return merged;
}

function overlapLength(a: Interval[], b: Interval[]): Rational {
  let total = Rational.ZERO;
  for (const [alo, ahi] of a) {
    for (const [blo, bhi] of b) {
      const lo = alo.cmp(blo) > 0 ? alo : blo;
      const hi = ahi.cmp(bhi) < 0 ? ahi : bhi;
      if (lo.cmp(hi) < 0) total = total.add(hi.sub(lo));
    }
  }
  return total;
}

/** Exact area of the part of `boundary` covered by the union of `polygons`. */
function coveredArea(boundary: readonly Point[], polygons: readonly (readonly Point[])[]): Rational {
  if (polygons.length === 0) return Rational.ZERO;
  const boundaryEdges = edgesOf(vertices(boundary));
  const polygonEdges = polygons.map((p) => edgesOf(vertices(p)));
  const allEdges = [boundaryEdges, ...polygonEdges].flat();
  const xs: Rational[] = allEdges.map((e) => e.a.x);
  for (let i = 0; i < allEdges.length; i++) {
    for (let j = i + 1; j < allEdges.length; j++) {
      const x = crossingX(allEdges[i]!, allEdges[j]!);
      if (x) xs.push(x);
    }
  }
  const slabs = sortUnique(xs);
  let area = Rational.ZERO;
  for (let i = 0; i + 1 < slabs.length; i++) {
    const x0 = slabs[i]!, x1 = slabs[i + 1]!;
    const mid = x0.add(x1).mul(HALF);
    const covered = union(polygonEdges.flatMap((edges) => sectionAt(edges, mid)));
    area = area.add(x1.sub(x0).mul(overlapLength(sectionAt(boundaryEdges, mid), covered)));
  }
  return area;
}

/** Exact area of a simple polygon (shoelace formula). */
export function polygonArea(polygon: readonly Point[]): Rational {
  const points = vertices(polygon);
  let twice = Rational.ZERO;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    twice = twice.add(p.x.mul(q.y).sub(q.x.mul(p.y)));
  });
  const area = twice.mul(HALF);
  return area.cmp(Rational.ZERO) < 0 ? Rational.ZERO.sub(area) : area;
}

/**
 * Area allocation in the given order: each polygon gets its area inside the boundary minus the area
 * already allocated, rounded half to even to whole square metres.
 */
export function allocateArea(boundary: readonly Point[], ordered: readonly (readonly Point[])[]): bigint[] {
  const allocations: bigint[] = [];
  let before = Rational.ZERO;
  for (let i = 0; i < ordered.length; i++) {
    const after = coveredArea(boundary, ordered.slice(0, i + 1));
    allocations.push(after.sub(before).roundHalfEven(0));
    before = after;
  }
  return allocations;
}
