import {
  type Connector,
  type Page,
  type Point,
  type Port,
  type Shape,
  byId,
  findShape,
  isConnectorShown,
  isLayerVisible,
} from './document.js';
import { type Box, boxBottom, boxOf, boxRight, portNormal, portPoint } from './geometry.js';

/** Rule 3 stub length and rule 4 clearance, in document units. */
export const CLEARANCE = 12;
/** Rule 7 separation between parallel segments of different connectors. */
export const SEPARATION = 8;

/** Candidate grid lines kept per axis, and how far around the ends obstacles are considered. */
const MAX_LINES = 36;
const SCOPE_PAD = 320;

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PortAnchor {
  key: string;
  /** The port's coordinate along the segment's varying axis. */
  at: number;
}

/** A segment of an already-routed connector, which later connectors must keep clear of. */
interface PlacedSegment {
  horizontal: boolean;
  /** y for a horizontal segment, x for a vertical one. */
  fixed: number;
  lo: number;
  hi: number;
  anchors: PortAnchor[];
}

export interface RoutedConnector {
  route: Point[];
  blocked: boolean;
}

function rectOf(box: Box, pad: number): Rect {
  return { x1: box.x - pad, y1: box.y - pad, x2: boxRight(box) + pad, y2: boxBottom(box) + pad };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** A segment is free when it does not pass through the open interior of any forbidden rect. */
function segmentFree(ax: number, ay: number, bx: number, by: number, rects: readonly Rect[]): boolean {
  const lox = Math.min(ax, bx);
  const hix = Math.max(ax, bx);
  const loy = Math.min(ay, by);
  const hiy = Math.max(ay, by);
  for (const r of rects) {
    if (lox < r.x2 && hix > r.x1 && loy < r.y2 && hiy > r.y1) return false;
  }
  return true;
}

function portKey(shapeId: string, port: Port): string {
  return `${shapeId}:${port}`;
}

/**
 * How much of a candidate segment sits closer than the separation distance to a parallel
 * segment of another connector, outside the shared-port allowance.
 */
function separationCost(
  horizontal: boolean,
  fixed: number,
  lo: number,
  hi: number,
  anchors: readonly PortAnchor[],
  placed: readonly PlacedSegment[],
): number {
  let cost = 0;
  for (const other of placed) {
    if (other.horizontal !== horizontal) continue;
    if (Math.abs(other.fixed - fixed) >= SEPARATION) continue;
    let overlapLo = Math.max(lo, other.lo);
    let overlapHi = Math.min(hi, other.hi);
    if (overlapHi <= overlapLo) continue;
    const shared = anchors.find((a) => other.anchors.some((b) => b.key === a.key));
    if (shared) {
      // Segments meeting at the same port may share their first or last 12 units.
      if (overlapLo >= shared.at - CLEARANCE && overlapHi <= shared.at + CLEARANCE) continue;
      if (overlapLo >= shared.at - CLEARANCE && overlapLo < shared.at + CLEARANCE) {
        overlapLo = shared.at + CLEARANCE;
      } else if (overlapHi > shared.at - CLEARANCE && overlapHi <= shared.at + CLEARANCE) {
        overlapHi = shared.at - CLEARANCE;
      }
      if (overlapHi <= overlapLo) continue;
    }
    cost += overlapHi - overlapLo;
  }
  return cost;
}

/**
 * The candidate grid lines for one axis. Terminal lines are always kept; when optional
 * lines overflow the budget the ones furthest from the route's midpoint are dropped.
 */
function gridLines(required: readonly number[], optional: readonly number[], centre: number): number[] {
  const kept = new Set(required.map((v) => Math.round(v)));
  const extra = [...new Set(optional.map((v) => Math.round(v)))]
    .filter((v) => !kept.has(v))
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))
    .slice(0, Math.max(0, MAX_LINES - kept.size));
  return [...kept, ...extra].sort((a, b) => a - b);
}

/** The separation cost of the 12-unit stub between a port and its first grid node. */
function stubSeparation(
  port: Point,
  stubEnd: Point,
  anchorKey: string,
  placed: readonly PlacedSegment[],
): number {
  const horizontal = port[1] === stubEnd[1];
  const axis = horizontal ? 0 : 1;
  const fixed = horizontal ? port[1] : port[0];
  const anchors: PortAnchor[] = [{ key: anchorKey, at: port[axis] }];
  return separationCost(
    horizontal,
    fixed,
    Math.min(port[axis], stubEnd[axis]),
    Math.max(port[axis], stubEnd[axis]),
    anchors,
    placed,
  );
}

/**
 * Lexicographic cost. Rules 1 to 4 are hard constraints on which segments exist at all.
 * Rule 7 is applied next, because it may shift segments sideways and so add bends, and
 * rule 5's fewest bends then shortest length settles the rest.
 */
interface Cost {
  sep: number;
  bends: number;
  len: number;
}

function cheaper(a: Cost, b: Cost): boolean {
  if (a.sep !== b.sep) return a.sep < b.sep;
  if (a.bends !== b.bends) return a.bends < b.bends;
  return a.len < b.len;
}

const STEPS: readonly Point[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function directionIndex(step: Point): number {
  return STEPS.findIndex((s) => s[0] === step[0] && s[1] === step[1]);
}

class StateHeap {
  private readonly items: { state: number; cost: Cost }[] = [];

  push(state: number, cost: Cost): void {
    this.items.push({ state, cost });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = this.items[i];
      const b = this.items[parent];
      if (!a || !b || !cheaper(a.cost, b.cost)) break;
      this.items[i] = b;
      this.items[parent] = a;
      i = parent;
    }
  }

  pop(): { state: number; cost: Cost } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (!top || !last) return top;
    if (this.items.length === 0) return top;
    this.items[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;
      const bestItem = this.items[best];
      const leftItem = this.items[left];
      const rightItem = this.items[right];
      if (bestItem && leftItem && cheaper(leftItem.cost, bestItem.cost)) best = left;
      const pivot = this.items[best];
      if (pivot && rightItem && cheaper(rightItem.cost, pivot.cost)) best = right;
      if (best === i) break;
      const a = this.items[i];
      const b = this.items[best];
      if (!a || !b) break;
      this.items[i] = b;
      this.items[best] = a;
      i = best;
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

interface RouteRequest {
  source: Shape;
  target: Shape;
  fromPort: Port;
  toPort: Port;
  obstacles: readonly Shape[];
  placed: readonly PlacedSegment[];
}

/**
 * Routes one connector under router rules 1 to 7. When no route can satisfy rule 4 the
 * route falls back to the fewest-bend route satisfying rules 1 to 3 and is blocked.
 */
function routeConnector(request: RouteRequest): RoutedConnector {
  const withObstacles = search(request, true);
  if (withObstacles) return { route: withObstacles, blocked: false };
  const fallback = search(request, false);
  return { route: fallback ?? directFallback(request), blocked: true };
}

function directFallback(request: RouteRequest): Point[] {
  const from = portPoint(request.source, request.fromPort);
  const fromNormal = portNormal(request.fromPort);
  const to = portPoint(request.target, request.toPort);
  const toNormal = portNormal(request.toPort);
  const a: Point = [from[0] + fromNormal[0] * CLEARANCE, from[1] + fromNormal[1] * CLEARANCE];
  const b: Point = [to[0] + toNormal[0] * CLEARANCE, to[1] + toNormal[1] * CLEARANCE];
  return simplify([from, a, [a[0], b[1]], b, to]);
}

function search(request: RouteRequest, respectObstacles: boolean): Point[] | null {
  const { source, target, fromPort, toPort, placed } = request;
  const from = portPoint(source, fromPort);
  const to = portPoint(target, toPort);
  const fromStep = portNormal(fromPort);
  const toStep = portNormal(toPort);
  const startNode: Point = [from[0] + fromStep[0] * CLEARANCE, from[1] + fromStep[1] * CLEARANCE];
  const goalNode: Point = [to[0] + toStep[0] * CLEARANCE, to[1] + toStep[1] * CLEARANCE];

  const fromAnchorKey = portKey(source.id, fromPort);
  const toAnchorKey = portKey(target.id, toPort);

  const scope = rectOf(
    {
      x: Math.min(source.x, target.x),
      y: Math.min(source.y, target.y),
      w: Math.max(boxRight(source), boxRight(target)) - Math.min(source.x, target.x),
      h: Math.max(boxBottom(source), boxBottom(target)) - Math.min(source.y, target.y),
    },
    SCOPE_PAD,
  );

  const rects: Rect[] = [];
  const requiredX = [from[0], to[0], startNode[0], goalNode[0]];
  const requiredY = [from[1], to[1], startNode[1], goalNode[1]];
  const xs: number[] = [source.x, boxRight(source), target.x, boxRight(target)];
  const ys: number[] = [source.y, boxBottom(source), target.y, boxBottom(target)];

  if (respectObstacles) {
    rects.push(rectOf(boxOf(source), 0), rectOf(boxOf(target), 0));
    for (const shape of request.obstacles) {
      if (shape.id === source.id || shape.id === target.id) continue;
      const grown = rectOf(boxOf(shape), CLEARANCE);
      if (!rectsOverlap(grown, scope)) continue;
      rects.push(grown);
      xs.push(grown.x1, grown.x2);
      ys.push(grown.y1, grown.y2);
    }
    for (const segment of placed) {
      if (segment.horizontal) {
        ys.push(segment.fixed, segment.fixed - SEPARATION, segment.fixed + SEPARATION);
      } else {
        xs.push(segment.fixed, segment.fixed - SEPARATION, segment.fixed + SEPARATION);
      }
    }
  }

  if (!segmentFree(from[0], from[1], startNode[0], startNode[1], rects)) return null;
  if (!segmentFree(goalNode[0], goalNode[1], to[0], to[1], rects)) return null;

  const gridX = gridLines(requiredX, xs, (from[0] + to[0]) / 2);
  const gridY = gridLines(requiredY, ys, (from[1] + to[1]) / 2);
  const nx = gridX.length;
  const ny = gridY.length;

  const startIx = gridX.indexOf(startNode[0]);
  const startIy = gridY.indexOf(startNode[1]);
  const goalIx = gridX.indexOf(goalNode[0]);
  const goalIy = gridY.indexOf(goalNode[1]);
  if (startIx < 0 || startIy < 0 || goalIx < 0 || goalIy < 0) return null;

  const startSep = stubSeparation(from, startNode, fromAnchorKey, placed);
  const goalSep = stubSeparation(to, goalNode, toAnchorKey, placed);

  const nodeCount = nx * ny;
  const stateCount = nodeCount * 4;
  const best: (Cost | undefined)[] = new Array(stateCount);
  const previous = new Int32Array(stateCount).fill(-1);
  const heap = new StateHeap();

  const startDir = directionIndex(fromStep);
  const finalDir = directionIndex([-toStep[0], -toStep[1]] as Point);
  const startState = (startIy * nx + startIx) * 4 + startDir;
  const startCost: Cost = { sep: startSep, bends: 0, len: CLEARANCE };
  best[startState] = startCost;
  heap.push(startState, startCost);

  const freeCache = new Map<number, number>();
  const segmentCost = (
    horizontal: boolean,
    fixed: number,
    lo: number,
    hi: number,
    cacheKey: number,
  ): number => {
    const cached = freeCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const free = horizontal
      ? segmentFree(lo, fixed, hi, fixed, rects)
      : segmentFree(fixed, lo, fixed, hi, rects);
    const value = free ? separationCost(horizontal, fixed, lo, hi, [], placed) : -1;
    freeCache.set(cacheKey, value);
    return value;
  };

  let bestGoal: { state: number; cost: Cost } | null = null;

  while (heap.size > 0) {
    const entry = heap.pop();
    if (!entry) break;
    const current = best[entry.state];
    if (!current || cheaper(current, entry.cost)) continue;
    const dir = entry.state % 4;
    const node = (entry.state - dir) / 4;
    const nodeIx = node % nx;
    const nodeIy = (node - nodeIx) / nx;

    if (nodeIx === goalIx && nodeIy === goalIy) {
      const cost: Cost = {
        bends: entry.cost.bends + (dir === finalDir ? 0 : 1),
        sep: entry.cost.sep + goalSep,
        len: entry.cost.len + CLEARANCE,
      };
      if (!bestGoal || cheaper(cost, bestGoal.cost)) bestGoal = { state: entry.state, cost };
    }
    if (bestGoal && !cheaper(entry.cost, bestGoal.cost)) continue;

    for (let next = 0; next < 4; next += 1) {
      if (next === (dir + 2) % 4) continue;
      const step = STEPS[next];
      if (!step) continue;
      const toIx = nodeIx + step[0];
      const toIy = nodeIy + step[1];
      if (toIx < 0 || toIx >= nx || toIy < 0 || toIy >= ny) continue;
      const horizontal = step[1] === 0;
      const ax = gridX[nodeIx];
      const ay = gridY[nodeIy];
      const bx = gridX[toIx];
      const by = gridY[toIy];
      if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
      const fixed = horizontal ? ay : ax;
      const lo = horizontal ? Math.min(ax, bx) : Math.min(ay, by);
      const hi = horizontal ? Math.max(ax, bx) : Math.max(ay, by);
      const cacheKey = horizontal
        ? (nodeIy * nx + Math.min(nodeIx, toIx)) * 2
        : (Math.min(nodeIy, toIy) * nx + nodeIx) * 2 + 1;
      const sep = segmentCost(horizontal, fixed, lo, hi, cacheKey);
      if (sep < 0) continue;
      const cost: Cost = {
        bends: entry.cost.bends + (next === dir ? 0 : 1),
        sep: entry.cost.sep + sep,
        len: entry.cost.len + (hi - lo),
      };
      const nextState = (toIy * nx + toIx) * 4 + next;
      const known = best[nextState];
      if (known && !cheaper(cost, known)) continue;
      best[nextState] = cost;
      previous[nextState] = entry.state;
      heap.push(nextState, cost);
    }
  }

  if (!bestGoal) return null;

  const points: Point[] = [to];
  let state = bestGoal.state;
  while (state >= 0) {
    const dir = state % 4;
    const node = (state - dir) / 4;
    const nodeIx = node % nx;
    const nodeIy = (node - nodeIx) / nx;
    const px = gridX[nodeIx];
    const py = gridY[nodeIy];
    if (px === undefined || py === undefined) break;
    points.push([px, py]);
    const parent = previous[state];
    state = parent === undefined ? -1 : parent;
  }
  points.push(from);
  points.reverse();
  return simplify(points);
}

/** Drops repeated and collinear points so each remaining point is a bend or an end. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push([point[0], point[1]]);
    const c = out.length;
    const a = out[c - 3];
    const b = out[c - 2];
    const d = out[c - 1];
    if (a && b && d && ((a[0] === b[0] && b[0] === d[0]) || (a[1] === b[1] && b[1] === d[1]))) {
      out.splice(c - 2, 1);
    }
  }
  return out;
}

function placedSegmentsOf(route: readonly Point[], connector: Connector): PlacedSegment[] {
  const segments: PlacedSegment[] = [];
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    if (!a || !b) continue;
    const horizontal = a[1] === b[1];
    const anchors: PortAnchor[] = [];
    if (i === 0) {
      anchors.push({
        key: portKey(connector.from.shape, connector.from.port),
        at: horizontal ? a[0] : a[1],
      });
    }
    if (i + 2 === route.length) {
      anchors.push({
        key: portKey(connector.to.shape, connector.to.port),
        at: horizontal ? b[0] : b[1],
      });
    }
    segments.push({
      horizontal,
      fixed: horizontal ? a[1] : a[0],
      lo: horizontal ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]),
      hi: horizontal ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]),
      anchors,
    });
  }
  return segments;
}

/**
 * Derives every shown connector's route on a page from shape geometry, port bindings and
 * the page's lower-id routes. Connectors that the layer rule hides keep their stored route.
 */
export function routePage(page: Page): Map<string, RoutedConnector> {
  const obstacles = page.shapes.filter((s) => isLayerVisible(page, s.layer));
  const placed: PlacedSegment[] = [];
  const result = new Map<string, RoutedConnector>();
  const ordered = [...page.connectors].sort((a, b) => byId(a.id, b.id));
  for (const connector of ordered) {
    if (!isConnectorShown(page, connector)) continue;
    const source = findShape(page, connector.from.shape);
    const target = findShape(page, connector.to.shape);
    if (!source || !target) continue;
    const routed = routeConnector({
      source,
      target,
      fromPort: connector.from.port,
      toPort: connector.to.port,
      obstacles,
      placed,
    });
    result.set(connector.id, routed);
    placed.push(...placedSegmentsOf(routed.route, connector));
  }
  return result;
}

/** Writes freshly derived routes into the page and reports which stored routes changed. */
export function reroutePage(page: Page): string[] {
  const routed = routePage(page);
  const changed: string[] = [];
  for (const connector of page.connectors) {
    const next = routed.get(connector.id);
    if (!next) continue;
    if (!sameRoute(connector.route, next.route)) {
      connector.route = next.route;
      changed.push(connector.id);
    }
  }
  return changed.sort(byId);
}

export function sameRoute(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (!pa || !pb || pa[0] !== pb[0] || pa[1] !== pb[1]) return false;
  }
  return true;
}
