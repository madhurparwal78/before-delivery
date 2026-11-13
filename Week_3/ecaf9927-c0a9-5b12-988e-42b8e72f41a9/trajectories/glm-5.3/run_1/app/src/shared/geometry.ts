import type { Direction, MeshBody, Operation, Plane, SketchEntity } from "./types.js";

/**
 * Geometry kernel. A part body is built from its extrudes in order by
 * evaluating each extrude's profile region and depth interval as a
 * predicate over a trapezoidal cell grid of the part's sketch frame. The
 * faces between inside and outside cells form one closed triangle mesh,
 * and volume, surface area and centroid follow from that mesh.
 */

export type Pt = [number, number];

const SNAP = 1e-9;
export const CIRCLE_FACETS = 128;

interface Ring {
  pts: Pt[];
}

export interface Profile {
  rings: Ring[];
  area: number;
}

function snap(v: number): number {
  return Math.abs(v) < SNAP ? 0 : v;
}

/** Build the profile rings of a sketch, or report why it is not extrudable. */
export function profileOf(
  entities: SketchEntity[]
): { profile: Profile } | { error: "not_closed" | "crossing" } {
  const lines = entities.filter((e): e is Extract<SketchEntity, { type: "line" }> => e.type === "line");
  const arcs = entities.filter((e): e is Extract<SketchEntity, { type: "arc" }> => e.type === "arc");
  const circles: Ring[] = entities
    .filter((e) => e.type === "circle")
    .map((e) => {
      const c = e as Extract<SketchEntity, { type: "circle" }>;
      return { pts: facetCircle([c.center.x, c.center.y], c.radius) };
    });

  interface Edge {
    from: Pt;
    to: Pt;
    arc?: Extract<SketchEntity, { type: "arc" }>;
  }
  const edges: Edge[] = [
    ...lines.map((l) => ({ from: [l.start.x, l.start.y] as Pt, to: [l.end.x, l.end.y] as Pt })),
    ...arcs.map((a) => ({ from: arcPoint(a, a.start_angle_deg), to: arcPoint(a, a.end_angle_deg), arc: a }))
  ];

  if (edges.length > 0) {
    const groups = new Map<string, number[]>();
    edges.forEach((e, i) => {
      for (const p of [e.from, e.to]) {
        const key = `${snap(p[0]).toFixed(6)},${snap(p[1]).toFixed(6)}`;
        groups.set(key, [...(groups.get(key) ?? []), i]);
      }
    });
    for (const edgeList of groups.values()) {
      if (edgeList.length !== 2) return { error: "not_closed" as const };
    }

    const groupAdjacency = new Map<number, number[]>();
    for (const edgeList of groups.values()) {
      const [a, b] = edgeList as [number, number];
      groupAdjacency.set(a, [...(groupAdjacency.get(a) ?? []), b]);
      groupAdjacency.set(b, [...(groupAdjacency.get(b) ?? []), a]);
    }
    void groupAdjacency;

    const used = new Set<number>();
    const rings: Ring[] = [];
    for (let start = 0; start < edges.length; start++) {
      if (used.has(start)) continue;
      const pts: Pt[] = [];
      let currentEdge = start;
      let entry = edges[start]!.from;
      let guard = edges.length + 1;
      while (guard-- > 0) {
        used.add(currentEdge);
        const e = edges[currentEdge]!;
        const exit = pointEq(entry, e.from) ? e.to : e.from;
        if (e.arc) {
          const f = facetArc(e.arc);
          pts.push(...(pointEq(entry, f[0]!) ? f : [...f].reverse()));
        } else {
          pts.push(entry, exit);
        }
        const nextEdge = (groups.get(`${snap(exit[0]).toFixed(6)},${snap(exit[1]).toFixed(6)}`) ?? []).find(
          (n) => !used.has(n)
        );
        if (nextEdge === undefined) break;
        entry = exit;
        currentEdge = nextEdge;
      }
      if (pts.length >= 3) rings.push({ pts: dedupeRing(pts) });
    }
    if (used.size !== edges.length) return { error: "not_closed" as const };

    const allRings = [...rings, ...circles];
    if (ringsCross(allRings)) return { error: "crossing" as const };
    return { profile: { rings: allRings, area: evenOddArea(allRings) } };
  }
  if (circles.length === 0) return { error: "not_closed" as const };
  if (ringsCross(circles)) return { error: "crossing" as const };
  return { profile: { rings: circles, area: evenOddArea(circles) } };
}

function dedupeRing(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length === 0 || !pointEq(out[out.length - 1]!, p)) out.push(p);
  }
  while (out.length > 1 && pointEq(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

function pointEq(a: Pt, b: Pt): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function arcPoint(a: Extract<SketchEntity, { type: "arc" }>, deg: number): Pt {
  const t = (deg * Math.PI) / 180;
  return [a.center.x + a.radius * Math.cos(t), a.center.y + a.radius * Math.sin(t)];
}

function facetCircle(c: Pt, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < CIRCLE_FACETS; i++) {
    const t = (2 * Math.PI * i) / CIRCLE_FACETS;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

function facetArc(a: Extract<SketchEntity, { type: "arc" }>): Pt[] {
  let span = (a.end_angle_deg - a.start_angle_deg) % 360;
  if (span <= 0) span += 360;
  const n = Math.max(2, Math.ceil((span / 360) * CIRCLE_FACETS));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push(arcPoint(a, a.start_angle_deg + (span * i) / n));
  }
  return pts;
}

/** True when rings cross each other or themselves. */
function ringsCross(rings: Ring[]): boolean {
  const segs: { a: Pt; b: Pt; ring: number; index: number }[] = [];
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.pts.length; i++) {
      segs.push({ a: ring.pts[i]!, b: ring.pts[(i + 1) % ring.pts.length]!, ring: ri, index: i });
    }
  });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i]!;
      const s2 = segs[j]!;
      if (s1.ring === s2.ring) {
        const n = ringLength(rings, s1.ring);
        const adjacent =
          (s1.index + 1) % n === s2.index || (s2.index + 1) % n === s1.index;
        if (adjacent) continue;
      }
      if (segmentsProperlyIntersect(s1.a, s1.b, s2.a, s2.b)) return true;
    }
  }
  return false;
}

function ringLength(rings: Ring[], index: number): number {
  return rings[index]!.pts.length;
}

function segmentsProperlyIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  // Touching points on a segment interior (not at shared endpoints) also
  // count as crossing for closed profiles.
  const within = (a: Pt, b: Pt, c: Pt) =>
    c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9;
  if (Math.abs(o1) < 1e-9 && within(p1, p2, p3) && !pointEq(p3, p1) && !pointEq(p3, p2)) return true;
  if (Math.abs(o2) < 1e-9 && within(p1, p2, p4) && !pointEq(p4, p1) && !pointEq(p4, p2)) return true;
  if (Math.abs(o3) < 1e-9 && within(p3, p4, p1) && !pointEq(p1, p3) && !pointEq(p1, p4)) return true;
  if (Math.abs(o4) < 1e-9 && within(p3, p4, p2) && !pointEq(p2, p3) && !pointEq(p2, p4)) return true;
  return false;
}

/** Even-odd area: a ring nested inside another is a hole. */
export function evenOddArea(rings: Ring[]): number {
  let total = 0;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]!;
    const absArea = Math.abs(signedArea(ring.pts));
    let nested = 0;
    for (let j = 0; j < rings.length; j++) {
      if (i === j) continue;
      if (pointInRing(ringMidpoint(ring.pts), rings[j]!.pts)) nested++;
    }
    total += nested % 2 === 0 ? absArea : -absArea;
  }
  return total;
}

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function ringMidpoint(pts: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / pts.length, cy / pts.length];
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd membership of a point against rings. */
function insideRings(p: Pt, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) if (pointInRing(p, ring.pts)) inside = !inside;
  return inside;
}

export function extrudeRange(direction: Direction, depth: number): [number, number] {
  switch (direction) {
    case "normal":
      return [0, depth];
    case "reverse":
      return [-depth, 0];
    case "symmetric":
      return [-depth / 2, depth / 2];
  }
}

export interface ExtrudeShape {
  plane: Plane;
  offset: number;
  rings: Ring[];
  t0: number;
  t1: number;
  operation: Operation;
}

export function shapeOf(
  plane: Plane,
  offset: number,
  direction: Direction,
  depth: number,
  rings: Ring[],
  operation: Operation
): ExtrudeShape {
  const [t0, t1] = extrudeRange(direction, depth);
  return { plane, offset, rings, t0, t1, operation };
}

export type BuildRefusal = "empty" | "separate" | "mixed_planes";

export interface BuildResult {
  ok: boolean;
  refusal: BuildRefusal | null;
  refusedOperation: Operation | null;
  mesh: { vertices: [number, number, number][]; triangles: [number, number, number][] };
  volume: number;
  area: number;
  centroid: [number, number, number];
}

interface Piece {
  a: Pt;
  b: Pt;
  /** Body inside-ness just left and right of the piece, per shape. */
  shapeLeft: Map<number, boolean>;
  shapeRight: Map<number, boolean>;
}

/**
 * A part's body from its extrudes, applied in order. Every profile edge of
 * every shape enters one arrangement: edges are split at all crossings and
 * touching vertices, each piece is classified on both sides against every
 * profile, and boundary faces are emitted exactly once. Walls follow
 * boundary pieces over each depth slab, and the faces at each depth plane
 * are the regions that switch between the slabs on either side.
 */
export function buildBody(shapes: ExtrudeShape[]): BuildResult {
  const empty = (refusal: BuildRefusal): BuildResult => ({
    ok: false,
    refusal,
    refusedOperation: shapes.length > 0 ? shapes[shapes.length - 1]!.operation : null,
    mesh: { vertices: [], triangles: [] },
    volume: 0,
    area: 0,
    centroid: [0, 0, 0]
  });
  if (shapes.length === 0) return empty("empty");
  const plane = shapes[0]!.plane;
  if (shapes.some((s) => s.plane !== plane)) {
    return empty("mixed_planes");
  }

  const pieces = arrangement(shapes);
  if (pieces.length === 0) return empty("empty");

  const tEvents = dedupeSorted(
    shapes.flatMap((s) => [s.offset + s.t0, s.offset + s.t1]).sort((a, b) => a - b)
  );
  const slabs: [number, number][] = [];
  for (let i = 0; i + 1 < tEvents.length; i++) slabs.push([tEvents[i]!, tEvents[i + 1]!]);

  // Per shape, per slab: is the shape's depth interval over the slab?
  const active: boolean[][] = shapes.map((s) =>
    slabs.map(([a, b]) => {
      const mid = (a + b) / 2;
      return mid > s.offset + s.t0 && mid < s.offset + s.t1;
    })
  );

  const vertices: [number, number, number][] = [];
  const triangles: [number, number, number][] = [];
  const vertexIndex = new Map<string, number>();
  const vertexAt = (u: number, v: number, t: number): number => {
    const key = `${u.toFixed(9)},${v.toFixed(9)},${t.toFixed(9)}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;
    vertices.push(mapToPlane(plane, shapes[0]!.offset, u, v, t));
    vertexIndex.set(key, vertices.length - 1);
    return vertices.length - 1;
  };

  const wallKeys = new Set<string>();

  // Walls: boundary pieces oriented with the body on their left.
  for (const piece of pieces) {
    for (let k = 0; k < slabs.length; k++) {
      const inside = bodyAt(shapes, active, piece.shapeLeft, k);
      const outside = bodyAt(shapes, active, piece.shapeRight, k);
      if (inside === outside) continue;
      const [t0, t1] = slabs[k]!;
      const { a, b } = piece;
      const key = `${a[0].toFixed(7)},${a[1].toFixed(7)},${b[0].toFixed(7)},${b[1].toFixed(7)},${t0.toFixed(7)},${t1.toFixed(7)}`;
      if (wallKeys.has(key)) continue;
      wallKeys.add(key);
      const i0 = vertexAt(a[0], a[1], t0);
      const i1 = vertexAt(b[0], b[1], t0);
      const i2 = vertexAt(b[0], b[1], t1);
      const i3 = vertexAt(a[0], a[1], t1);
      // The body on the left means the outward normal points right of a->b.
      if (inside) triangles.push([i0, i1, i2], [i0, i2, i3]);
      else triangles.push([i1, i0, i3], [i1, i3, i2]);
    }
  }

  // Faces at each depth plane: the regions that switch between the slabs
  // on either side of the plane, facing the slab that holds the body.
  for (const t of tEvents) {
    const capPieces: { a: Pt; b: Pt; bodyBelowLeft: boolean }[] = [];
    for (const piece of pieces) {
      const belowLeft = bodyAt(shapes, active, piece.shapeLeft, slabIndexBelow(tEvents, t));
      const belowRight = bodyAt(shapes, active, piece.shapeRight, slabIndexBelow(tEvents, t));
      const aboveLeft = bodyAt(shapes, active, piece.shapeLeft, slabIndexBelow(tEvents, t) + 1);
      const aboveRight = bodyAt(shapes, active, piece.shapeRight, slabIndexBelow(tEvents, t) + 1);
      const xorLeft = belowLeft !== aboveLeft;
      const xorRight = belowRight !== aboveRight;
      if (xorLeft === xorRight) continue;
      capPieces.push(
        xorLeft
          ? { a: piece.a, b: piece.b, bodyBelowLeft: belowLeft }
          : { a: piece.b, b: piece.a, bodyBelowLeft: belowRight }
      );
    }
    if (capPieces.length === 0) continue;
    const groups = chainIntoRegions(capPieces);
    for (const group of groups) {
      const facing = group.bodyBelow ? "up" : "down";
      const tri = triangulateRegion(group.outer, group.holes, t, facing, vertexAt);
      for (const tr of tri) triangles.push(tr);
    }
  }

  if (triangles.length === 0) return empty("empty");
  if (meshVolume(vertices, triangles) < 0) {
    for (let i = 0; i < triangles.length; i++) {
      const tr = triangles[i]!;
      triangles[i] = [tr[0]!, tr[2]!, tr[1]!];
    }
  }
  if (meshComponents(vertices, triangles) > 1) {
    return empty("separate");
  }
  const props = massProperties(vertices, triangles);
  if (props.volume <= 1e-9) return empty("empty");
  return {
    ok: true,
    refusal: null,
    refusedOperation: null,
    mesh: { vertices, triangles },
    volume: props.volume,
    area: props.area,
    centroid: props.centroid
  };
}

function dedupeSorted(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || v - out[out.length - 1]! > 1e-9) out.push(v);
  }
  return out;
}

/** Index of the slab lying below a depth plane; -1 when none does. */
function slabIndexBelow(tEvents: number[], t: number): number {
  const idx = tEvents.indexOf(t);
  return idx - 1;
}

/** Evaluate the body's CSG at a piece side sample within slab k (out of range: outside). */
function bodyAt(
  shapes: ExtrudeShape[],
  active: boolean[][],
  sample: Map<number, boolean>,
  k: number
): boolean {
  let inBody = false;
  for (let s = 0; s < shapes.length; s++) {
    const inShape =
      (sample.get(s) ?? false) && k >= 0 && k < active[s]!.length && active[s]![k]!;
    switch (shapes[s]!.operation) {
      case "new":
        inBody = inShape;
        break;
      case "join":
        inBody = inBody || inShape;
        break;
      case "cut":
        inBody = inBody && !inShape;
        break;
      case "intersect":
        inBody = inBody && inShape;
        break;
    }
  }
  return inBody;
}

/** Split every profile edge at every crossing and touching vertex. */
function arrangement(shapes: ExtrudeShape[]): Piece[] {
  interface Seg {
    a: Pt;
    b: Pt;
  }
  const segs: Seg[] = [];
  for (const s of shapes) {
    for (const ring of s.rings) {
      const pts = ring.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if (!pointEq(a, b)) segs.push({ a, b });
      }
    }
  }

  const cuts: Map<number, number>[] = segs.map(() => new Map<number, number>());
  for (let i = 0; i < segs.length; i++) {
    const s1 = segs[i]!;
    for (let j = i + 1; j < segs.length; j++) {
      const s2 = segs[j]!;
      for (const hit of segmentHits(s1, s2)) {
        if (hit.t1 > 1e-9 && hit.t1 < 1 - 1e-9) cuts[i]!.set(hit.t1, 1);
        if (hit.t2 > 1e-9 && hit.t2 < 1 - 1e-9) cuts[j]!.set(hit.t2, 1);
      }
    }
  }

  const pieces: Piece[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    for (const part of splitAtCuts(seg, cuts[i]!)) {
      const dx = part.b[0] - part.a[0];
      const dy = part.b[1] - part.a[1];
      const len = Math.hypot(dx, dy);
      const mid: Pt = [(part.a[0] + part.b[0]) / 2, (part.a[1] + part.b[1]) / 2];
      const eps = Math.min(len * 1e-3, 1e-5);
      const shapeLeft = new Map<number, boolean>();
      const shapeRight = new Map<number, boolean>();
      shapes.forEach((s, si) => {
        shapeLeft.set(si, insideRings([mid[0] - (dy / len) * eps, mid[1] + (dx / len) * eps], s.rings));
        shapeRight.set(si, insideRings([mid[0] + (dy / len) * eps, mid[1] - (dx / len) * eps], s.rings));
      });
      pieces.push({ a: part.a, b: part.b, shapeLeft, shapeRight });
    }
  }
  return pieces;
}

interface SegHit {
  t1: number;
  t2: number;
  p: Pt;
}

/** Where two segments meet: crossings, endpoint touches and overlaps. */
function segmentHits(s1: { a: Pt; b: Pt }, s2: { a: Pt; b: Pt }): SegHit[] {
  const hits: SegHit[] = [];
  const d1x = s1.b[0] - s1.a[0];
  const d1y = s1.b[1] - s1.a[1];
  const d2x = s2.b[0] - s2.a[0];
  const d2y = s2.b[1] - s2.a[1];
  const den = d1x * d2y - d1y * d2x;
  const cross = (s2.a[0] - s1.a[0]) * d1y - (s2.a[1] - s1.a[1]) * d1x;
  if (Math.abs(den) > 1e-12) {
    const t = ((s2.a[0] - s1.a[0]) * d2y - (s2.a[1] - s1.a[1]) * d2x) / den;
    const u = ((s2.a[0] - s1.a[0]) * d1y - (s2.a[1] - s1.a[1]) * d1x) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      hits.push({ t1: t, t2: u, p: [s1.a[0] + t * d1x, s1.a[1] + t * d1y] });
    }
  } else if (Math.abs(cross) < 1e-7) {
    // Collinear: split at the endpoints of one lying inside the other.
    for (const p of [s2.a, s2.b]) {
      const t1 = projectT(s1, p);
      if (t1 > 1e-9 && t1 < 1 - 1e-9) hits.push({ t1, t2: projectT(s2, p), p });
    }
  }
  // T-junctions: an endpoint of one lying in the other's interior.
  for (const p of [s2.a, s2.b]) {
    if (pointOnSegment(p, s1)) hits.push({ t1: projectT(s1, p), t2: projectT(s2, p), p });
  }
  for (const p of [s1.a, s1.b]) {
    if (pointOnSegment(p, s2)) hits.push({ t1: projectT(s1, p), t2: projectT(s2, p), p });
  }
  return hits;
}

function projectT(s: { a: Pt; b: Pt }, p: Pt): number {
  const dx = s.b[0] - s.a[0];
  const dy = s.b[1] - s.a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return 0;
  return ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / len2;
}

function pointOnSegment(p: Pt, s: { a: Pt; b: Pt }): boolean {
  const cross = (p[0] - s.a[0]) * (s.b[1] - s.a[1]) - (p[1] - s.a[1]) * (s.b[0] - s.a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  const t = projectT(s, p);
  return t > 1e-9 && t < 1 - 1e-9;
}

function splitAtCuts(seg: { a: Pt; b: Pt }, cuts: Map<number, number>): { a: Pt; b: Pt }[] {
  if (cuts.size === 0) return [{ a: seg.a, b: seg.b }];
  const params = [...cuts.keys()].sort((x, y) => x - y);
  const pts: Pt[] = [seg.a];
  for (const t of params) {
    if (t <= 1e-9 || t >= 1 - 1e-9) continue;
    pts.push([seg.a[0] + t * (seg.b[0] - seg.a[0]), seg.a[1] + t * (seg.b[1] - seg.a[1])]);
  }
  pts.push(seg.b);
  const parts: { a: Pt; b: Pt }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (!pointEq(pts[i]!, pts[i + 1]!)) parts.push({ a: pts[i]!, b: pts[i + 1]! });
  }
  return parts;
}

interface CapPiece {
  a: Pt;
  b: Pt;
  bodyBelowLeft: boolean;
}

interface RegionGroup {
  outer: Pt[];
  holes: Pt[][];
  bodyBelow: boolean;
}

/** Chain oriented cap pieces into regions of one outer ring and its holes. */
function chainIntoRegions(pieces: CapPiece[]): RegionGroup[] {
  const key = (p: Pt) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const outgoing = new Map<string, CapPiece[]>();
  for (const p of pieces) outgoing.set(key(p.a), [...(outgoing.get(key(p.a)) ?? []), p]);
  const used = new Set<string>();
  const rings: { pts: Pt[]; bodyBelow: boolean }[] = [];
  for (const start of pieces) {
    const startKey = `${key(start.a)}>${key(start.b)}`;
    if (used.has(startKey)) continue;
    const ring: Pt[] = [start.a];
    let current = start.b;
    let bodyBelow = start.bodyBelowLeft;
    used.add(startKey);
    let guard = pieces.length + 1;
    while (guard-- > 0) {
      const options = outgoing.get(key(current)) ?? [];
      const next = options.find((o) => !used.has(`${key(current)}>${key(o.b)}`));
      if (!next) break;
      used.add(`${key(current)}>${key(next.b)}`);
      if (!pointEq(ring[0]!, current)) ring.push(current);
      current = next.b;
    }
    if (ring.length >= 3 && pointEq(ring[0]!, current)) rings.push({ pts: ring, bodyBelow });
  }

  // Group rings: outer rings keep material inside; nested rings are holes.
  const groups: RegionGroup[] = [];
  const depthOf = (r: { pts: Pt[] }): number => {
    const sample = interiorSample(r.pts);
    return rings.filter((other) => other !== r && pointInRing(sample, other.pts)).length;
  };
  const ringDepth = rings.map(depthOf);
  for (let i = 0; i < rings.length; i++) {
    if (ringDepth[i]! % 2 !== 0) continue;
    const holes: Pt[][] = [];
    for (let j = 0; j < rings.length; j++) {
      if (ringDepth[j]! % 2 !== 1) continue;
      if (containedInRing(rings[j]!, rings[i]!)) holes.push(rings[j]!.pts);
    }
    groups.push({ outer: rings[i]!.pts, holes, bodyBelow: rings[i]!.bodyBelow });
  }
  return groups;
}

function containedInRing(inner: { pts: Pt[] }, outer: { pts: Pt[] }): boolean {
  let best = -Infinity;
  let bestPt: Pt | null = null;
  for (const p of inner.pts) {
    if (p[0] > best) {
      best = p[0];
      bestPt = p;
    }
  }
  return bestPt !== null && pointInRing(bestPt, outer.pts);
}

/** A point just inside a ring's own enclosed area, used to test nesting. */
function interiorSample(pts: Pt[]): Pt {
  const a = pts[0]!;
  const b = pts[1]!;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const eps = Math.min(len * 1e-3, 1e-5);
  const ccw = signedArea(pts) > 0;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return ccw
    ? [mid[0] - (dy / len) * eps, mid[1] + (dx / len) * eps]
    : [mid[0] + (dy / len) * eps, mid[1] - (dx / len) * eps];
}

/** Triangulate an outer ring with holes at one depth plane. */
function triangulateRegion(
  outer: Pt[],
  holes: Pt[][],
  t: number,
  facing: "up" | "down",
  vertexAt: (u: number, v: number, t: number) => number
): [number, number, number][] {
  const polygon = bridgeHoles(outer, holes);
  const result: [Pt, Pt, Pt][] = [];
  const pts = polygon;
  let remaining = pts.map((_, i) => i);
  let guard = pts.length * pts.length + 10;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let ri = 0; ri < remaining.length && !clipped; ri++) {
      const prev = remaining[(ri - 1 + remaining.length) % remaining.length]!;
      const cur = remaining[ri]!;
      const next = remaining[(ri + 1) % remaining.length]!;
      const a = pts[prev]!;
      const b = pts[cur]!;
      const c = pts[next]!;
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-12) continue;
      let earOk = true;
      for (const j of remaining) {
        if (j === prev || j === cur || j === next) continue;
        if (pointEq(pts[j]!, a) || pointEq(pts[j]!, b) || pointEq(pts[j]!, c)) continue;
        if (strictlyInsideTriangle(pts[j]!, a, b, c)) {
          earOk = false;
          break;
        }
      }
      if (!earOk) continue;
      result.push([a, b, c]);
      remaining.splice(ri, 1);
      clipped = true;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    result.push([pts[remaining[0]!]!, pts[remaining[1]!]!, pts[remaining[2]!]!]);
  }
  const tris: [number, number, number][] = [];
  for (const [a, b, c] of result) {
    const ia = vertexAt(a[0], a[1], t);
    const ib = vertexAt(b[0], b[1], t);
    const ic = vertexAt(c[0], c[1], t);
    if (ia === ib || ib === ic || ia === ic) continue;
    tris.push(facing === "up" ? [ia, ib, ic] : [ia, ic, ib]);
  }
  return tris;
}

/** Cut holes into the outer ring with two-vertex bridges. */
function bridgeHoles(outer: Pt[], holes: Pt[][]): Pt[] {
  let polygon = ensureCcw(outer.slice());
  for (const hole of holes) {
    const cw = ensureCw(hole.slice());
    // Closest visible outer vertex to the hole's rightmost point.
    let hi = 0;
    for (let i = 1; i < cw.length; i++) {
      if (cw[i]![0] > cw[hi]![0]) hi = i;
    }
    let oi = 0;
    let bestDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      if (polygon[i]![0] < cw[hi]![0] - 1e-9) continue;
      const d = (polygon[i]![0] - cw[hi]![0]) ** 2 + (polygon[i]![1] - cw[hi]![1]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        oi = i;
      }
    }
    const rotatedHole = [...cw.slice(hi), ...cw.slice(0, hi)];
    polygon = [
      ...polygon.slice(0, oi + 1),
      ...rotatedHole,
      rotatedHole[0]!,
      polygon[oi]!,
      ...polygon.slice(oi + 1)
    ];
  }
  return polygon;
}

function ensureCcw(pts: Pt[]): Pt[] {
  return signedArea(pts) >= 0 ? pts : pts.slice().reverse();
}

function ensureCw(pts: Pt[]): Pt[] {
  return signedArea(pts) <= 0 ? pts : pts.slice().reverse();
}

function strictlyInsideTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9;
}

/** Connected components of a mesh by shared welded vertices. */
function meshComponents(
  vertices: [number, number, number][],
  triangles: [number, number, number][]
): number {
  const weld = new Map<string, number>();
  const weldedIndex = (vi: number): number => {
    const v = vertices[vi]!;
    const key = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
    const existing = weld.get(key);
    if (existing !== undefined) return existing;
    const next = weld.size;
    weld.set(key, next);
    return next;
  };
  const parent: number[] = [];
  const find = (i: number): number => {
    while (parent[i] !== undefined && parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const tr of triangles) {
    for (const vi of tr) {
      const w = weldedIndex(vi);
      while (parent.length <= w) parent.push(parent.length);
    }
    union(weldedIndex(tr[0]!), weldedIndex(tr[1]!));
    union(weldedIndex(tr[1]!), weldedIndex(tr[2]!));
  }
  const roots = new Set<number>();
  for (const tr of triangles) roots.add(find(weldedIndex(tr[0]!)));
  return roots.size;
}

function mapToPlane(plane: Plane, offset: number, u: number, v: number, t: number): [number, number, number] {
  switch (plane) {
    case "top":
      return [u, v, offset + t];
    case "front":
      return [u, offset + t, v];
    case "right":
      return [offset + t, u, v];
  }
}

/** Signed volume of a closed triangle mesh (negative when wound inward). */
function meshVolume(vertices: [number, number, number][], triangles: [number, number, number][]): number {
  let volume6 = 0;
  for (const [ai, bi, ci] of triangles) {
    volume6 += tripleProduct(vertices[ai]!, vertices[bi]!, vertices[ci]!);
  }
  return volume6 / 6;
}

/** det of the 3x3 matrix with rows p, q, r: six times a tetrahedron volume. */
function tripleProduct(
  p: [number, number, number],
  q: [number, number, number],
  r: [number, number, number]
): number {
  return (
    p[0] * (q[1] * r[2] - q[2] * r[1]) -
    p[1] * (q[0] * r[2] - q[2] * r[0]) +
    p[2] * (q[0] * r[1] - q[1] * r[0])
  );
}

/** Mass properties of a closed triangle mesh. */
export function massProperties(
  vertices: [number, number, number][],
  triangles: [number, number, number][]
): { volume: number; area: number; centroid: [number, number, number] } {
  let volume6 = 0;
  const cx = [0, 0, 0];
  let area2 = 0;
  const areaCentroid = [0, 0, 0];
  for (const [ai, bi, ci] of triangles) {
    const p = vertices[ai]!;
    const q = vertices[bi]!;
    const r = vertices[ci]!;
    const det = tripleProduct(p, q, r);
    volume6 += det;
    for (let k = 0; k < 3; k++) cx[k] = cx[k]! + det * (p[k]! + q[k]! + r[k]!);
    const len = Math.hypot(
      (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
      (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    );
    area2 += len;
    for (let k = 0; k < 3; k++) areaCentroid[k] = areaCentroid[k]! + (len * (p[k]! + q[k]! + r[k]!)) / 3;
  }
  const volume = volume6 / 6;
  const area = area2 / 2;
  const centroid: [number, number, number] =
    Math.abs(volume6) > 1e-12
      ? [cx[0]! / (4 * volume6), cx[1]! / (4 * volume6), cx[2]! / (4 * volume6)]
      : [areaCentroid[0]! / area2, areaCentroid[1]! / area2, areaCentroid[2]! / area2];
  return { volume, area, centroid };
}

export function meshBodyOf(
  partId: string,
  build: number,
  mesh: { vertices: [number, number, number][]; triangles: [number, number, number][] }
): MeshBody {
  return { part_id: partId, build, units: "mm", vertices: mesh.vertices, triangles: mesh.triangles };
}

export function insideProfileAt(entities: SketchEntity[], p: Pt): boolean {
  const result = profileOf(entities);
  if ("error" in result) return false;
  return insideRings(p, result.profile.rings);
}

/** Preview area of a sketch profile, for extrude previews. */
export function profileAreaOf(entities: SketchEntity[]): number {
  const result = profileOf(entities);
  if ("error" in result) return 0;
  return Math.abs(result.profile.area);
}
