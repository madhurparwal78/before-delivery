import type { EntityGeometry, Point2 } from './api.js';

export const CIRCLE_SEGMENTS = 512;
const WELD_TOLERANCE = 1e-6;

export type ProfileLoop = {
  /** Closed polygon, counter-clockwise, without a repeated first point. */
  points: Point2[];
  /** How many other loops enclose this one. Odd depths are holes. */
  depth: number;
};

export type Profile = { loops: ProfileLoop[]; area_mm2: number };

/**
 * Full circles use the radius whose inscribed polygon has exactly the circle's area, so
 * faceted volumes match the closed-form figures. Arc vertices stay on the true arc, which
 * keeps their shared endpoints exact.
 */
function areaPreservingRadius(radius: number, segmentAngle: number): number {
  return radius * Math.sqrt(segmentAngle / Math.sin(segmentAngle));
}

function circlePolygon(center: Point2, radius: number): Point2[] {
  const step = (2 * Math.PI) / CIRCLE_SEGMENTS;
  const corrected = areaPreservingRadius(radius, step);
  const points: Point2[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const angle = step * i;
    points.push({
      x: center.x + corrected * Math.cos(angle),
      y: center.y + corrected * Math.sin(angle),
    });
  }
  return points;
}

function arcPolyline(geometry: Extract<EntityGeometry, { type: 'arc' }>): Point2[] {
  const start = (geometry.start_angle_deg * Math.PI) / 180;
  const end = (geometry.end_angle_deg * Math.PI) / 180;
  let sweep = (end - start) % (2 * Math.PI);
  if (sweep <= 0) sweep += 2 * Math.PI;
  const segments = Math.max(2, Math.ceil((CIRCLE_SEGMENTS * sweep) / (2 * Math.PI)));
  const points: Point2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + (sweep * i) / segments;
    points.push({
      x: geometry.center.x + geometry.radius * Math.cos(angle),
      y: geometry.center.y + geometry.radius * Math.sin(angle),
    });
  }
  return points;
}

export function signedArea(points: Point2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Point2;
    const b = points[(i + 1) % points.length] as Point2;
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

function toCounterClockwise(points: Point2[]): Point2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

type Edge = { polyline: Point2[]; nodeA: number; nodeB: number };

function weldNodes(ends: Point2[]): number[] {
  const nodes: Point2[] = [];
  return ends.map((point) => {
    const found = nodes.findIndex(
      (node) => Math.abs(node.x - point.x) <= WELD_TOLERANCE && Math.abs(node.y - point.y) <= WELD_TOLERANCE,
    );
    if (found >= 0) return found;
    nodes.push(point);
    return nodes.length - 1;
  });
}

function segmentsProperlyCross(
  p1: Point2,
  p2: Point2,
  p3: Point2,
  p4: Point2,
): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-12) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator;
  const margin = 1e-9;
  return t > margin && t < 1 - margin && u > margin && u < 1 - margin;
}

type IndexedSegment = { a: Point2; b: Point2; minX: number; maxX: number };

function anyCrossing(loops: Point2[][]): boolean {
  const segments: IndexedSegment[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i] as Point2;
      const b = loop[(i + 1) % loop.length] as Point2;
      segments.push({ a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) });
    }
  }
  segments.sort((left, right) => left.minX - right.minX);
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i] as IndexedSegment;
    for (let j = i + 1; j < segments.length; j += 1) {
      const other = segments[j] as IndexedSegment;
      if (other.minX > current.maxX) break;
      if (segmentsProperlyCross(current.a, current.b, other.a, other.b)) return true;
    }
  }
  return false;
}

function interiorPoint(points: Point2[]): Point2 {
  let index = 0;
  for (let i = 1; i < points.length; i += 1) {
    const candidate = points[i] as Point2;
    const best = points[index] as Point2;
    if (candidate.y < best.y || (candidate.y === best.y && candidate.x < best.x)) index = i;
  }
  const corner = points[index] as Point2;
  const previous = points[(index - 1 + points.length) % points.length] as Point2;
  const next = points[(index + 1) % points.length] as Point2;
  const toPrevious = normalise(previous.x - corner.x, previous.y - corner.y);
  const toNext = normalise(next.x - corner.x, next.y - corner.y);
  const bisector = normalise(toPrevious.x + toNext.x, toPrevious.y + toNext.y);
  const reach =
    1e-3 *
    Math.min(
      Math.hypot(previous.x - corner.x, previous.y - corner.y),
      Math.hypot(next.x - corner.x, next.y - corner.y),
    );
  return { x: corner.x + bisector.x * reach, y: corner.y + bisector.y * reach };
}

function normalise(x: number, y: number): Point2 {
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 0, y: 1 } : { x: x / length, y: y / length };
}

function contains(loop: Point2[], probe: Point2): boolean {
  let inside = false;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i] as Point2;
    const b = loop[(i + 1) % loop.length] as Point2;
    if (a.y > probe.y !== b.y > probe.y) {
      const x = a.x + ((probe.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x > probe.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * The closed region a sketch bounds, or `null` when its strokes do not form clean loops.
 * Loops nested inside another loop alternate between material and hole.
 */
export function buildProfile(entities: EntityGeometry[]): Profile | null {
  const polygons: Point2[][] = [];
  const edges: Edge[] = [];
  const ends: Point2[] = [];
  const openPolylines: Point2[][] = [];

  for (const entity of entities) {
    if (entity.type === 'point') continue;
    if (entity.type === 'circle') {
      polygons.push(circlePolygon(entity.center, entity.radius));
      continue;
    }
    const polyline = entity.type === 'line' ? [entity.start, entity.end] : arcPolyline(entity);
    openPolylines.push(polyline);
    ends.push(polyline[0] as Point2, polyline[polyline.length - 1] as Point2);
  }

  const nodeOf = weldNodes(ends);
  for (let i = 0; i < openPolylines.length; i += 1) {
    edges.push({
      polyline: openPolylines[i] as Point2[],
      nodeA: nodeOf[i * 2] as number,
      nodeB: nodeOf[i * 2 + 1] as number,
    });
  }

  const incident = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i] as Edge;
    for (const node of [edge.nodeA, edge.nodeB]) {
      const list = incident.get(node);
      if (list) list.push(i);
      else incident.set(node, [i]);
    }
  }
  for (const list of incident.values()) if (list.length !== 2) return null;

  const used = new Array<boolean>(edges.length).fill(false);
  for (let seed = 0; seed < edges.length; seed += 1) {
    if (used[seed]) continue;
    const startNode = (edges[seed] as Edge).nodeA;
    let node = startNode;
    let edgeIndex = seed;
    const points: Point2[] = [];
    for (;;) {
      const edge = edges[edgeIndex] as Edge;
      used[edgeIndex] = true;
      const forward = edge.nodeA === node;
      const walk = forward ? edge.polyline : [...edge.polyline].reverse();
      for (let i = 0; i < walk.length - 1; i += 1) points.push(walk[i] as Point2);
      node = forward ? edge.nodeB : edge.nodeA;
      if (node === startNode) break;
      const options = incident.get(node) as number[];
      const nextIndex = options[0] === edgeIndex ? (options[1] as number) : (options[0] as number);
      if (used[nextIndex]) return null;
      edgeIndex = nextIndex;
    }
    if (points.length < 3) return null;
    polygons.push(points);
  }

  if (polygons.length === 0) return null;
  const loops = polygons.map(toCounterClockwise);
  if (anyCrossing(loops)) return null;

  const probes = loops.map(interiorPoint);
  const result: ProfileLoop[] = loops.map((points, index) => {
    let depth = 0;
    for (let other = 0; other < loops.length; other += 1) {
      if (other !== index && contains(loops[other] as Point2[], probes[index] as Point2)) depth += 1;
    }
    return { points, depth };
  });

  let area = 0;
  for (const loop of result) {
    area += (loop.depth % 2 === 0 ? 1 : -1) * Math.abs(signedArea(loop.points));
  }
  if (area <= 0) return null;
  return { loops: result, area_mm2: area };
}
