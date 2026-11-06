import type { Connector, PageDocument, PointTuple, Port, Shape, Zone } from './types';
import { PORTS } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function portPoint(shape: Rect, port: Port): Point {
  switch (port) {
    case 'n':
      return { x: shape.x + Math.floor(shape.width / 2), y: shape.y };
    case 'e':
      return { x: shape.x + shape.width, y: shape.y + Math.floor(shape.height / 2) };
    case 's':
      return { x: shape.x + Math.floor(shape.width / 2), y: shape.y + shape.height };
    case 'w':
      return { x: shape.x, y: shape.y + Math.floor(shape.height / 2) };
  }
}

/** The elbow path: start, (mid x, start y), (mid x, end y), end, with halves rounded up. */
export function elbowPath(start: Point, end: Point): PointTuple[] {
  const midX = Math.ceil((start.x + end.x) / 2);
  return dedupePoints([
    [start.x, start.y],
    [midX, start.y],
    [midX, end.y],
    [end.x, end.y],
  ]);
}

/** Drops repeated points and the redundant middle of three collinear points. */
export function dedupePoints(points: PointTuple[]): PointTuple[] {
  const out: PointTuple[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    const previous = out[out.length - 2];
    if (last && previous) {
      const collinearX = previous[0] === last[0] && last[0] === point[0];
      const collinearY = previous[1] === last[1] && last[1] === point[1];
      if (collinearX || collinearY) out.pop();
    }
    out.push([point[0], point[1]]);
  }
  return out;
}

export function countBends(points: PointTuple[]): number {
  return Math.max(0, dedupePoints(points).length - 2);
}

function segmentHitsInterior(a: PointTuple, b: PointTuple, rect: Rect): boolean {
  const x0 = rect.x;
  const x1 = rect.x + rect.width;
  const y0 = rect.y;
  const y1 = rect.y + rect.height;
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  return maxX > x0 && minX < x1 && maxY > y0 && minY < y1;
}

function pathHitsInterior(points: PointTuple[], obstacles: Rect[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    for (const obstacle of obstacles) {
      if (segmentHitsInterior(a, b, obstacle)) return true;
    }
  }
  return false;
}

export function boundingBoxOf(rects: Rect[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const ROUTE_SLACK = 48;

function withinSlack(points: PointTuple[], box: Rect): boolean {
  const minX = box.x - ROUTE_SLACK;
  const maxX = box.x + box.width + ROUTE_SLACK;
  const minY = box.y - ROUTE_SLACK;
  const maxY = box.y + box.height + ROUTE_SLACK;
  return points.every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

/**
 * The routing rule: keep the ports, stay orthogonal, pass through no other
 * shape's interior. Prefer the elbow path, else the fewest-bends path near the
 * two shapes' bounding box, else the elbow path anyway.
 */
export function routeConnector(source: Shape, sourcePort: Port, target: Shape, targetPort: Port, shapes: Shape[]): PointTuple[] {
  const start = portPoint(source, sourcePort);
  const end = portPoint(target, targetPort);
  const obstacles: Rect[] = shapes.filter((shape) => shape.id !== source.id && shape.id !== target.id);
  const elbow = elbowPath(start, end);
  if (!pathHitsInterior(elbow, obstacles)) return elbow;

  const box = boundingBoxOf([source, target]);
  const xs = candidateLines(start.x, end.x, box.x, box.x + box.width, obstacles.flatMap((o) => [o.x, o.x + o.width]));
  const ys = candidateLines(start.y, end.y, box.y, box.y + box.height, obstacles.flatMap((o) => [o.y, o.y + o.height]));

  const candidates: PointTuple[][] = [];
  candidates.push([
    [start.x, start.y],
    [end.x, start.y],
    [end.x, end.y],
  ]);
  candidates.push([
    [start.x, start.y],
    [start.x, end.y],
    [end.x, end.y],
  ]);
  for (const x of xs) {
    candidates.push([
      [start.x, start.y],
      [x, start.y],
      [x, end.y],
      [end.x, end.y],
    ]);
  }
  for (const y of ys) {
    candidates.push([
      [start.x, start.y],
      [start.x, y],
      [end.x, y],
      [end.x, end.y],
    ]);
  }
  for (const x of xs) {
    for (const y of ys) {
      candidates.push([
        [start.x, start.y],
        [x, start.y],
        [x, y],
        [end.x, y],
        [end.x, end.y],
      ]);
      candidates.push([
        [start.x, start.y],
        [start.x, y],
        [x, y],
        [x, end.y],
        [end.x, end.y],
      ]);
    }
  }

  let best: PointTuple[] | null = null;
  let bestBends = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const points = dedupePoints(candidate);
    if (!withinSlack(points, box)) continue;
    if (pathHitsInterior(points, obstacles)) continue;
    const bends = countBends(points);
    if (bends < bestBends) {
      best = points;
      bestBends = bends;
    }
  }
  return best ?? elbow;
}

function candidateLines(a: number, b: number, boxLow: number, boxHigh: number, obstacleLines: number[]): number[] {
  const values = new Set<number>([
    a,
    b,
    Math.ceil((a + b) / 2),
    boxLow - ROUTE_SLACK,
    boxLow - 24,
    boxLow,
    boxHigh,
    boxHigh + 24,
    boxHigh + ROUTE_SLACK,
  ]);
  for (const line of obstacleLines) {
    values.add(line);
  }
  return [...values].sort((p, q) => p - q);
}

/** Reroutes every connector attached to one of the given shapes. */
export function rerouteConnectorsFor(doc: PageDocument, movedShapeIds: ReadonlySet<string>): void {
  const shapeById = new Map(doc.shapes.map((shape) => [shape.id, shape]));
  for (const connector of doc.connectors) {
    if (!movedShapeIds.has(connector.from.shapeId) && !movedShapeIds.has(connector.to.shapeId)) continue;
    const source = shapeById.get(connector.from.shapeId);
    const target = shapeById.get(connector.to.shapeId);
    if (!source || !target) continue;
    connector.points = routeConnector(source, connector.from.port, target, connector.to.port, doc.shapes);
  }
}

/** Re-anchors a connector's endpoints without changing its interior shape, used after a pure translation. */
export function translateConnectorPoints(connector: Connector, dx: number, dy: number): void {
  connector.points = connector.points.map(([x, y]) => [x + dx, y + dy] as PointTuple);
}

export function closestPortPair(source: Shape, target: Shape): { from: Port; to: Port } {
  let best: { from: Port; to: Port } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const from of PORTS) {
    for (const to of PORTS) {
      const a = portPoint(source, from);
      const b = portPoint(target, to);
      const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { from, to };
      }
    }
  }
  if (!best) throw new Error('no port pair');
  return best;
}

export function zonesOverlap(a: Zone, b: Zone): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

export function anyZonesOverlap(zones: Zone[]): boolean {
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i];
      const b = zones[j];
      if (a && b && zonesOverlap(a, b)) return true;
    }
  }
  return false;
}

export function snapToGrid(value: number, grid: number): number {
  return Math.floor(value / grid + 0.5) * grid;
}
