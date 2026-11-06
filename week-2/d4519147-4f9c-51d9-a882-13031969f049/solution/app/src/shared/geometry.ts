import type { Connector, PageDoc, Point, PortSide, Rect, Shape, Zone } from "./model.ts";

const PORT_ORDER: readonly PortSide[] = ["n", "e", "s", "w"];

export function portPoint(shape: Rect, side: PortSide): Point {
  const { x, y, width: w, height: h } = shape;
  switch (side) {
    case "n": return [x + Math.floor(w / 2), y];
    case "e": return [x + w, y + Math.floor(h / 2)];
    case "s": return [x + Math.floor(w / 2), y + h];
    case "w": return [x, y + Math.floor(h / 2)];
  }
}

/** The port pair whose points are closest; ties go to the earlier port in the order north, east, south, west. */
export function closestPorts(a: Rect, b: Rect): [PortSide, PortSide] {
  let best: [PortSide, PortSide] = ["n", "n"];
  let bestDistance = Infinity;
  for (const pa of PORT_ORDER) {
    for (const pb of PORT_ORDER) {
      const [ax, ay] = portPoint(a, pa);
      const [bx, by] = portPoint(b, pb);
      const d = (ax - bx) ** 2 + (ay - by) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = [pa, pb];
      }
    }
  }
  return best;
}

function dropRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
}

/** start, (mid x, start y), (mid x, end y), end; mid x rounds halves up. Repeated points are dropped. */
export function elbowPath(start: Point, end: Point): Point[] {
  const mid = Math.floor((start[0] + end[0] + 1) / 2);
  return dropRepeats([start, [mid, start[1]], [mid, end[1]], end]);
}

function segmentHitsInterior(a: Point, b: Point, r: Rect): boolean {
  if (a[1] === b[1]) {
    const y = a[1];
    if (!(y > r.y && y < r.y + r.height)) return false;
    return Math.max(Math.min(a[0], b[0]), r.x) < Math.min(Math.max(a[0], b[0]), r.x + r.width);
  }
  const x = a[0];
  if (!(x > r.x && x < r.x + r.width)) return false;
  return Math.max(Math.min(a[1], b[1]), r.y) < Math.min(Math.max(a[1], b[1]), r.y + r.height);
}

function pathHitsInterior(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const o of obstacles) if (segmentHitsInterior(points[i]!, points[i + 1]!, o)) return true;
  }
  return false;
}

interface Step { node: number; dir: number; bends: number; length: number }

/** Orthogonal path with the fewest bends (then shortest) inside `region`, avoiding obstacle interiors. */
function fewestBends(start: Point, end: Point, region: Rect, obstacles: readonly Rect[]): Point[] | null {
  const inRegion = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const xs = new Set<number>([start[0], end[0], region.x, region.x + region.width]);
  const ys = new Set<number>([start[1], end[1], region.y, region.y + region.height]);
  for (const o of obstacles) {
    for (const v of [o.x, o.x + o.width]) if (inRegion(v, region.x, region.x + region.width)) xs.add(v);
    for (const v of [o.y, o.y + o.height]) if (inRegion(v, region.y, region.y + region.height)) ys.add(v);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const cols = X.length;
  const id = (i: number, j: number) => j * cols + i;
  const startId = id(X.indexOf(start[0]), Y.indexOf(start[1]));
  const endId = id(X.indexOf(end[0]), Y.indexOf(end[1]));
  const moves: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const best = new Map<string, [number, number]>();
  const prev = new Map<string, string>();
  const key = (node: number, dir: number) => `${node}:${dir}`;
  const queue: Step[] = [];
  for (let d = 0; d < 4; d++) {
    queue.push({ node: startId, dir: d, bends: 0, length: 0 });
    best.set(key(startId, d), [0, 0]);
  }
  const better = (a: Step, b: Step) => a.bends - b.bends || a.length - b.length;
  while (queue.length) {
    queue.sort(better);
    const cur = queue.shift()!;
    const curBest = best.get(key(cur.node, cur.dir));
    if (curBest && (curBest[0] < cur.bends || (curBest[0] === cur.bends && curBest[1] < cur.length))) continue;
    if (cur.node === endId) {
      const nodes: number[] = [];
      let k: string | undefined = key(cur.node, cur.dir);
      while (k) {
        nodes.push(Number(k.split(":")[0]));
        k = prev.get(k);
      }
      nodes.reverse();
      const pts = nodes.map((n): Point => [X[n % cols]!, Y[Math.floor(n / cols)]!]);
      return simplify(pts);
    }
    const ci = cur.node % cols, cj = Math.floor(cur.node / cols);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = moves[d]!;
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= Y.length) continue;
      const a: Point = [X[ci]!, Y[cj]!], b: Point = [X[ni]!, Y[nj]!];
      if (obstacles.some((o) => segmentHitsInterior(a, b, o))) continue;
      const next: Step = {
        node: id(ni, nj),
        dir: d,
        bends: cur.bends + (d === cur.dir || cur.node === startId ? 0 : 1),
        length: cur.length + Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]),
      };
      const k = key(next.node, d);
      const seen = best.get(k);
      if (seen && (seen[0] < next.bends || (seen[0] === next.bends && seen[1] <= next.length))) continue;
      best.set(k, [next.bends, next.length]);
      prev.set(k, key(cur.node, cur.dir));
      queue.push(next);
    }
  }
  return null;
}

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of dropRepeats(points)) {
    const n = out.length;
    if (n >= 2 && ((out[n - 2]![0] === out[n - 1]![0] && out[n - 1]![0] === p[0]) || (out[n - 2]![1] === out[n - 1]![1] && out[n - 1]![1] === p[1]))) {
      out[n - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

const DETOUR = 48;

/** Connector routing: the elbow path if it passes through no other shape's interior, else the fewest-bends path within 48 units of both shapes' box, else the elbow path. */
export function routeBetween(a: Shape, fromPort: PortSide, b: Shape, toPort: PortSide, shapes: readonly Shape[]): Point[] {
  const start = portPoint(a, fromPort);
  const end = portPoint(b, toPort);
  const elbow = elbowPath(start, end);
  const others = shapes.filter((s) => s.id !== a.id && s.id !== b.id);
  if (!pathHitsInterior(elbow, others)) return elbow;
  const x0 = Math.min(a.x, b.x) - DETOUR, y0 = Math.min(a.y, b.y) - DETOUR;
  const x1 = Math.max(a.x + a.width, b.x + b.width) + DETOUR, y1 = Math.max(a.y + a.height, b.y + b.height) + DETOUR;
  const region: Rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const near = others.filter((o) => o.x < x1 && o.x + o.width > x0 && o.y < y1 && o.y + o.height > y0);
  return fewestBends(start, end, region, near) ?? elbow;
}

/** Reroutes every connector attached to one of `moved` (shape ids). */
export function rerouteAttached(doc: Pick<PageDoc, "shapes" | "connectors">, moved: ReadonlySet<string>): Connector[] {
  const byId = new Map(doc.shapes.map((s) => [s.id, s]));
  return doc.connectors.map((c) => {
    if (!moved.has(c.from.shapeId) && !moved.has(c.to.shapeId)) return c;
    const a = byId.get(c.from.shapeId), b = byId.get(c.to.shapeId);
    if (!a || !b) return c;
    return { ...c, points: routeBetween(a, c.from.port, b, c.to.port, doc.shapes) };
  });
}

/** Zones overlap when their rectangles overlap or touch. */
export function zonesTouch(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function anyZonesTouch(zones: readonly Zone[]): boolean {
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) if (zonesTouch(zones[i]!, zones[j]!)) return true;
  }
  return false;
}

export function snapToGrid(value: number, grid: number): number {
  return Math.floor(value / grid + 0.5) * grid;
}
