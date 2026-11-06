// Domain rules: ports, membership, crossings, routing.
// Every rule here has exactly one implementation; browser and server both call it.

import {
  Connector, CrossingPoint, Derived, DerivedZone, PageDocument, PortName, Shape, Zone,
} from './types.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function portPoint(shape: Shape, port: PortName): [number, number] {
  const w = shape.width;
  const h = shape.height;
  switch (port) {
    case 'n': return [shape.x + Math.floor(w / 2), shape.y];
    case 'e': return [shape.x + w, shape.y + Math.floor(h / 2)];
    case 's': return [shape.x + Math.floor(w / 2), shape.y + h];
    case 'w': return [shape.x, shape.y + Math.floor(h / 2)];
  }
}

export const PORT_ORDER: readonly PortName[] = ['n', 'e', 's', 'w'];

// A shape belongs to a zone when its centre lies inside the zone rectangle or on its edge.
export function zoneContains(zone: Zone, shape: Shape): boolean {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  return cx >= zone.x && cx <= zone.x + zone.width && cy >= zone.y && cy <= zone.y + zone.height;
}

// Overlap includes touching edges.
export function zonesOverlap(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function rectCenter(r: Rect): [number, number] {
  return [r.x + r.width / 2, r.y + r.height / 2];
}

export function elbowPath(start: [number, number], end: [number, number]): [number, number][] {
  const midX = Math.ceil((start[0] + end[0]) / 2);
  const pts: [number, number][] = [start, [midX, start[1]], [midX, end[1]], end];
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    if (pts[i][0] !== last[0] || pts[i][1] !== last[1]) out.push(pts[i]);
  }
  return out;
}

// The closest port pair; ties keep the earlier pair in n, e, s, w order.
export function closestPorts(source: Shape, target: Shape): { from: PortName; to: PortName } {
  let from: PortName = 'n';
  let to: PortName = 'n';
  let best = Infinity;
  for (const p of PORT_ORDER) {
    const sp = portPoint(source, p);
    for (const q of PORT_ORDER) {
      const tp = portPoint(target, q);
      const d = (sp[0] - tp[0]) ** 2 + (sp[1] - tp[1]) ** 2;
      if (d < best) { best = d; from = p; to = q; }
    }
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// Crossing derivation.

type Side = 'inside' | 'outside' | 'edge';

interface Checkpoint {
  x: number;
  y: number;
  side: Side;
}

// Walk the orthogonal path and find every place it crosses the zone's edge.
// Side runs are reduced first, so a path that touches the edge and returns to
// the same side does not cross, and a path that runs along the edge crosses at
// the last position where it was on the edge.
function crossingsAlongPath(
  points: readonly [number, number][],
  zone: Zone,
): { x: number; y: number; direction: 'in' | 'out' }[] {
  const reduced: [number, number][] = [];
  for (const p of points) {
    const last = reduced[reduced.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) reduced.push([p[0], p[1]]);
  }
  if (reduced.length < 2) return [];

  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i + 1 < reduced.length; i++) {
    const a = reduced[i];
    const b = reduced[i + 1];
    const vertical = a[0] === b[0];
    const fixed = vertical ? a[0] : a[1];
    const startT = vertical ? a[1] : a[0];
    const endT = vertical ? b[1] : b[0];
    const lo = Math.min(startT, endT);
    const hi = Math.max(startT, endT);
    const perpA = vertical ? zone.x : zone.y;
    const perpB = vertical ? zone.x + zone.width : zone.y + zone.height;
    const parA = vertical ? zone.y : zone.x;
    const parB = vertical ? zone.y + zone.height : zone.x + zone.width;

    const sideOfT = (t: number): Side => {
      if (fixed < perpA || fixed > perpB) return 'outside';
      if (fixed === perpA || fixed === perpB) return t >= parA && t <= parB ? 'edge' : 'outside';
      if (t < parA || t > parB) return 'outside';
      if (t === parA || t === parB) return 'edge';
      return 'inside';
    };
    const push = (t: number, side: Side) => {
      checkpoints.push(vertical ? { x: fixed, y: t, side } : { x: t, y: fixed, side });
    };
    // Breakpoints along the segment where the side can change, walked in the
    // path's traversal order so entering and leaving read correctly.
    const breaks: number[] = [lo, hi];
    if (parA > lo && parA < hi) breaks.push(parA);
    if (parB > lo && parB < hi) breaks.push(parB);
    breaks.sort((p, q) => p - q);
    if (startT > endT) breaks.reverse();
    for (let j = 0; j < breaks.length; j++) {
      push(breaks[j], sideOfT(breaks[j]));
      if (j + 1 < breaks.length) {
        const mid = (breaks[j] + breaks[j + 1]) / 2;
        const sm = sideOfT(mid);
        if (sm !== sideOfT(breaks[j])) push(mid, sm);
      }
    }
  }

  const runs: { side: Side; x: number; y: number }[] = [];
  for (const cp of checkpoints) {
    const last = runs[runs.length - 1];
    if (last && last.side === cp.side) {
      last.x = cp.x;
      last.y = cp.y;
    } else {
      runs.push({ side: cp.side, x: cp.x, y: cp.y });
    }
  }

  const out: { x: number; y: number; direction: 'in' | 'out' }[] = [];
  for (let i = 1; i + 1 < runs.length; i++) {
    if (runs[i].side !== 'edge') continue;
    const before = runs[i - 1].side;
    const after = runs[i + 1].side;
    if (before === after) continue;
    out.push({ x: runs[i].x, y: runs[i].y, direction: before === 'outside' ? 'in' : 'out' });
  }
  return out;
}

// Zone membership, crossing points and counts, derived from the saved page.
export function derivePage(page: PageDocument): Derived {
  const zones: DerivedZone[] = page.zones.map((zone) => {
    const members = page.shapes
      .filter((s) => zoneContains(zone, s))
      .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1))
      .map((s) => s.id);
    return { id: zone.id, systems: members.length, crossings: 0, members };
  });
  const crossings: CrossingPoint[] = [];
  for (const conn of page.connectors) {
    for (const zone of page.zones) {
      for (const c of crossingsAlongPath(conn.points, zone)) {
        crossings.push({ zoneId: zone.id, connectorId: conn.id, x: c.x, y: c.y, direction: c.direction });
      }
    }
  }
  crossings.sort((a, b) => {
    if (a.zoneId !== b.zoneId) return a.zoneId < b.zoneId ? -1 : 1;
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.connectorId < b.connectorId ? -1 : 1;
  });
  for (const c of crossings) {
    const z = zones.find((zz) => zz.id === c.zoneId);
    if (z) z.crossings++;
  }
  return { zones, crossings };
}

// ---------------------------------------------------------------------------
// Connector routing after a shape move: keep ports, reroute orthogonally.

function pathIntersectsInterior(
  points: readonly [number, number][],
  shapes: readonly Shape[],
  skip: ReadonlySet<string>,
): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const vertical = a[0] === b[0];
    for (const s of shapes) {
      if (skip.has(s.id)) continue;
      if (vertical) {
        const lo = Math.min(a[1], b[1]);
        const hi = Math.max(a[1], b[1]);
        if (a[0] > s.x && a[0] < s.x + s.width && hi > s.y && lo < s.y + s.height) return true;
      } else {
        const lo = Math.min(a[0], b[0]);
        const hi = Math.max(a[0], b[0]);
        if (a[1] > s.y && a[1] < s.y + s.height && hi > s.x && lo < s.x + s.width) return true;
      }
    }
  }
  return false;
}

interface RerouteContext {
  shapes: readonly Shape[];
  fromId: string;
  toId: string;
}

// Fewest-bend orthogonal path whose every point lies within 48 units of the
// bounding box of the two shapes, passing through no other shape's interior.
function fewestBendsPath(
  start: [number, number],
  end: [number, number],
  ctx: RerouteContext,
): [number, number][] | null {
  const { shapes } = ctx;
  const fromS = shapes.find((s) => s.id === ctx.fromId);
  const toS = shapes.find((s) => s.id === ctx.toId);
  if (!fromS || !toS) return null;
  const box: Rect = {
    x: Math.min(fromS.x, toS.x),
    y: Math.min(fromS.y, toS.y),
    width: Math.max(fromS.x + fromS.width, toS.x + toS.width) - Math.min(fromS.x, toS.x),
    height: Math.max(fromS.y + fromS.height, toS.y + toS.height) - Math.min(fromS.y, toS.y),
  };
  const x1 = box.x - 48, y1 = box.y - 48, x2 = box.x + box.width + 48, y2 = box.y + box.height + 48;
  const inBox = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  if (!inBox(start[0], start[1]) || !inBox(end[0], end[1])) return null;
  const clean = (pts: [number, number][]): [number, number][] => {
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const last = out[out.length - 1];
      if (pts[i][0] !== last[0] || pts[i][1] !== last[1]) out.push(pts[i]);
    }
    return out;
  };
  const skip = new Set([ctx.fromId, ctx.toId]);
  const tryPath = (pts: [number, number][]): [number, number][] | null => {
    const c = clean(pts);
    if (!c.every((p) => inBox(p[0], p[1]))) return null;
    if (pathIntersectsInterior(c, shapes, skip)) return null;
    return c;
  };
  if (start[0] === end[0] || start[1] === end[1]) {
    const p = tryPath([start, end]);
    if (p) return p;
  }
  for (const mid of [[end[0], start[1]], [start[0], end[1]]] as [number, number][]) {
    const p = tryPath([start, mid, end]);
    if (p) return p;
  }
  const laneXs = new Set<number>([start[0], end[0], Math.ceil((start[0] + end[0]) / 2)]);
  const laneYs = new Set<number>([start[1], end[1], Math.ceil((start[1] + end[1]) / 2)]);
  for (const s of [fromS, toS]) {
    for (const v of [s.x - 24, s.x, s.x + s.width, s.x + s.width + 24]) laneXs.add(v);
    for (const v of [s.y - 24, s.y, s.y + s.height, s.y + s.height + 24]) laneYs.add(v);
  }
  for (const ly of laneYs) {
    const p = tryPath([start, [ly, start[1]], [ly, end[1]], end]);
    if (p) return p;
  }
  for (const lx of laneXs) {
    const p = tryPath([start, [start[0], lx], [end[0], lx], end]);
    if (p) return p;
  }
  for (const lx of laneXs) {
    for (const ly of laneYs) {
      const p = tryPath([start, [lx, start[1]], [lx, ly], [end[0], ly], end]);
      if (p) return p;
    }
  }
  return null;
}

// Reroute one connector after its end shapes moved, keeping its ports.
export function rerouteConnector(conn: Connector, ctx: RerouteContext): [number, number][] {
  const fromShape = ctx.shapes.find((s) => s.id === conn.from.shapeId);
  const toShape = ctx.shapes.find((s) => s.id === conn.to.shapeId);
  if (!fromShape || !toShape) return conn.points;
  const start = portPoint(fromShape, conn.from.port);
  const end = portPoint(toShape, conn.to.port);
  const elbow = elbowPath(start, end);
  const skip = new Set([fromShape.id, toShape.id]);
  if (!pathIntersectsInterior(elbow, ctx.shapes, skip)) return elbow;
  const alt = fewestBendsPath(start, end, ctx);
  return alt ?? elbow;
}
