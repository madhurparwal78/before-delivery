// Router rules 1 to 7 (brief: Geometry rules, Router rules). The server and the browser call the
// same functions, so a route drawn during a drag equals the route the server stores.
import { portPoint, visibleLayerIds } from "./geometry";
import type { Box, Connector, Page, Point, Port, Shape } from "./types";

const CLEARANCE = 12;
const SEPARATION = 8;
const STUB = 12;

const BEND = 1e7;
const WINDOW_MARGIN = 96;
/** Unit steps for the directions east, south, west, north. */
const dx = (d: number) => (d === 0 ? 1 : d === 2 ? -1 : 0);
const dy = (d: number) => (d === 1 ? 1 : d === 3 ? -1 : 0);
const PORT_DIR: Record<Port, number> = { e: 0, s: 1, w: 2, n: 3 };

/** A fixed segment of a lower-id connector; `end` names the shape:port when it is a first or last segment. */
interface Fixed {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  end: string | null;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Endpoint {
  box: Box;
  port: Port;
  key: string;
}

interface Problem {
  from: Endpoint;
  to: Endpoint;
  obstacles: Box[];
  fixed: Fixed[];
}

interface RouteResult {
  route: Point[];
  blocked: boolean;
}

/** A connector is shown, routed against and exported only when its layer and both end layers are visible. */
export function isShown(page: Page, connector: Connector, visible: Set<string> = visibleLayerIds(page),
  byId: Map<string, Shape> = new Map(page.shapes.map((s) => [s.id, s]))): boolean {
  const a = byId.get(connector.from.shape);
  const b = byId.get(connector.to.shape);
  return !!a && !!b && visible.has(connector.layer) && visible.has(a.layer) && visible.has(b.layer);
}

function inflate(box: Box, by: number): Bounds {
  return { minX: box.x - by, minY: box.y - by, maxX: box.x + box.w + by, maxY: box.y + box.h + by };
}

function boundsOfPoints(points: Point[]): Bounds {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxX: Math.max(...points.map((p) => p[0])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** True when the open interior of `area` meets the axis-parallel segment. */
function segmentHits(area: Bounds, x1: number, y1: number, x2: number, y2: number): boolean {
  const lx = Math.min(x1, x2);
  const hx = Math.max(x1, x2);
  const ly = Math.min(y1, y2);
  const hy = Math.max(y1, y2);
  if (ly === hy) return ly > area.minY && ly < area.maxY && hx > area.minX && lx < area.maxX;
  return lx > area.minX && lx < area.maxX && hy > area.minY && ly < area.maxY;
}

/** True when a new segment lies closer than SEPARATION to a parallel fixed segment over an overlapping span. */
function tooClose(f: Fixed, x1: number, y1: number, x2: number, y2: number): boolean {
  const horizontal = y1 === y2;
  if (horizontal !== (f.y1 === f.y2)) return false;
  if (horizontal) {
    if (f.x1 === f.x2) return false;
    if (Math.abs(f.y1 - y1) >= SEPARATION) return false;
    return Math.min(Math.max(x1, x2), Math.max(f.x1, f.x2)) - Math.max(Math.min(x1, x2), Math.min(f.x1, f.x2)) > 0;
  }
  if (Math.abs(f.x1 - x1) >= SEPARATION) return false;
  return Math.min(Math.max(y1, y2), Math.max(f.y1, f.y2)) - Math.max(Math.min(y1, y2), Math.min(f.y1, f.y2)) > 0;
}

interface SearchRules {
  bounds: Bounds;
  obstacles: Bounds[];
  ownBoxes: Bounds[];
  fixed: Fixed[];
}

/** Lexicographic (bends, length) shortest orthogonal path over the coordinate grid, or null. */
function search(problem: Problem, rules: SearchRules): Point[] | null {
  const p = portPoint(problem.from.box, problem.from.port);
  const q = portPoint(problem.to.box, problem.to.port);
  const d0 = PORT_DIR[problem.from.port];
  const dq = PORT_DIR[problem.to.port];
  const s: Point = [p[0] + dx(d0) * STUB, p[1] + dy(d0) * STUB];
  const t: Point = [q[0] + dx(dq) * STUB, q[1] + dy(dq) * STUB];
  const inward = (dq + 2) % 4;

  const blocked = (x1: number, y1: number, x2: number, y2: number, stubKey: string | null): boolean => {
    for (const o of rules.obstacles) if (segmentHits(o, x1, y1, x2, y2)) return true;
    for (const o of rules.ownBoxes) if (segmentHits(o, x1, y1, x2, y2)) return true;
    for (const f of rules.fixed) if ((stubKey === null || f.end !== stubKey) && tooClose(f, x1, y1, x2, y2)) return true;
    return false;
  };
  if (blocked(p[0], p[1], s[0], s[1], problem.from.key) || blocked(t[0], t[1], q[0], q[1], problem.to.key)) return null;

  const b = rules.bounds;
  const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const xsSet = new Set<number>([b.minX, b.maxX, s[0], t[0]]);
  const ysSet = new Set<number>([b.minY, b.maxY, s[1], t[1]]);
  for (const o of [...rules.obstacles, ...rules.ownBoxes]) {
    xsSet.add(o.minX).add(o.maxX).add(o.minX - SEPARATION).add(o.maxX + SEPARATION);
    ysSet.add(o.minY).add(o.maxY).add(o.minY - SEPARATION).add(o.maxY + SEPARATION);
  }
  for (const f of rules.fixed) {
    if (f.y1 === f.y2) ysSet.add(f.y1 - SEPARATION).add(f.y1 + SEPARATION);
    else xsSet.add(f.x1 - SEPARATION).add(f.x1 + SEPARATION);
  }
  const xs = [...xsSet].filter((v) => within(v, b.minX, b.maxX)).sort((m, n) => m - n);
  const ys = [...ysSet].filter((v) => within(v, b.minY, b.maxY)).sort((m, n) => m - n);
  const nx = xs.length;
  const ny = ys.length;
  const ix0 = xs.indexOf(s[0]);
  const iy0 = ys.indexOf(s[1]);
  const ixT = xs.indexOf(t[0]);
  const iyT = ys.indexOf(t[1]);
  if (ix0 < 0 || iy0 < 0 || ixT < 0 || iyT < 0) return null;

  const states = nx * ny * 4;
  const cost = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const edgeH = new Uint8Array(nx * ny);
  const edgeV = new Uint8Array(nx * ny);
  const open = (ix: number, iy: number, dir: number): boolean => {
    const horizontal = dir === 0 || dir === 2;
    const ax = dir === 2 ? ix - 1 : ix;
    const ay = dir === 3 ? iy - 1 : iy;
    const cache = horizontal ? edgeH : edgeV;
    const slot = ay * nx + ax;
    if (cache[slot] === 0) {
      const x1 = xs[ax] as number;
      const y1 = ys[ay] as number;
      const x2 = horizontal ? (xs[ax + 1] as number) : x1;
      const y2 = horizontal ? y1 : (ys[ay + 1] as number);
      cache[slot] = blocked(x1, y1, x2, y2, null) ? 2 : 1;
    }
    return cache[slot] === 1;
  };

  const heap: number[] = [];
  const prio: number[] = [];
  const order: number[] = [];
  let counter = 0;
  const less = (i: number, j: number) => (prio[i] as number) < (prio[j] as number) || (prio[i] === prio[j] && (order[i] as number) < (order[j] as number));
  const push = (state: number, f: number) => {
    heap.push(state);
    prio.push(f);
    order.push(counter++);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!less(i, up)) break;
      [heap[i], heap[up]] = [heap[up] as number, heap[i] as number];
      [prio[i], prio[up]] = [prio[up] as number, prio[i] as number];
      [order[i], order[up]] = [order[up] as number, order[i] as number];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0] as number;
    const f = prio[0] as number;
    const lastState = heap.pop() as number;
    const lastPrio = prio.pop() as number;
    const lastOrder = order.pop() as number;
    if (heap.length) {
      heap[0] = lastState;
      prio[0] = lastPrio;
      order[0] = lastOrder;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as number, heap[i] as number];
        [prio[i], prio[m]] = [prio[m] as number, prio[i] as number];
        [order[i], order[m]] = [order[m] as number, order[i] as number];
        i = m;
      }
    }
    return [top, f];
  };
  const heuristic = (ix: number, iy: number) => Math.abs((xs[ix] as number) - t[0]) + Math.abs((ys[iy] as number) - t[1]);

  const startState = (iy0 * nx + ix0) * 4 + d0;
  cost[startState] = 0;
  push(startState, heuristic(ix0, iy0));
  let best = Infinity;
  let bestState = -1;
  while (heap.length) {
    const [state, f] = pop();
    if (f >= best) break;
    const g = cost[state] as number;
    if (f > g + heuristic(((state >> 2) % nx), Math.floor((state >> 2) / nx)) + 1e-9) continue;
    const node = state >> 2;
    const dir = state & 3;
    const ix = node % nx;
    const iy = Math.floor(node / nx);
    if (ix === ixT && iy === iyT) {
      const total = g + (dir === inward ? 0 : BEND);
      if (total < best) {
        best = total;
        bestState = state;
      }
      continue;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (dir + 2) % 4) continue;
      const jx = ix + dx(nd);
      const jy = iy + dy(nd);
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      if (!open(ix, iy, nd)) continue;
      const step = Math.abs((xs[jx] as number) - (xs[ix] as number)) + Math.abs((ys[jy] as number) - (ys[iy] as number));
      const next = (jy * nx + jx) * 4 + nd;
      const ng = g + step + (nd === dir ? 0 : BEND);
      if (ng < (cost[next] as number)) {
        cost[next] = ng;
        parent[next] = state;
        push(next, ng + heuristic(jx, jy));
      }
    }
  }
  if (bestState < 0) return null;
  const path: Point[] = [];
  for (let st = bestState; st >= 0; st = parent[st] as number) {
    const node = st >> 2;
    path.push([xs[node % nx] as number, ys[Math.floor(node / nx)] as number]);
  }
  path.reverse();
  return simplify([p, ...path, q]);
}

/** Drops repeated points and the middle point of every straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev[0] === last[0] && last[0] === point[0]) || (prev[1] === last[1] && last[1] === point[1]))) out.pop();
    out.push(point);
  }
  return out;
}

function windowAround(problem: Problem): Bounds {
  const p = portPoint(problem.from.box, problem.from.port);
  const q = portPoint(problem.to.box, problem.to.port);
  const area = boundsOfPoints([p, q]);
  return {
    minX: area.minX - STUB - WINDOW_MARGIN,
    minY: area.minY - STUB - WINDOW_MARGIN,
    maxX: area.maxX + STUB + WINDOW_MARGIN,
    maxY: area.maxY + STUB + WINDOW_MARGIN,
  };
}

function bendCount(route: Point[]): number {
  return Math.max(0, route.length - 2);
}

/** The window grown to hold, with room to pass around, every obstacle that meets it (one step, so a drag frame stays cheap). */
function reach(problem: Problem, rules: SearchRules): Bounds {
  const window = rules.bounds;
  const areas = [window, ...problem.obstacles.filter((o) => intersects(inflate(o, CLEARANCE), window)).map((o) => inflate(o, CLEARANCE + WINDOW_MARGIN))];
  return {
    minX: Math.min(...areas.map((a) => a.minX)),
    minY: Math.min(...areas.map((a) => a.minY)),
    maxX: Math.max(...areas.map((a) => a.maxX)),
    maxY: Math.max(...areas.map((a) => a.maxY)),
  };
}

function fullBounds(problem: Problem): Bounds {
  const areas = [windowAround(problem), ...problem.obstacles.map((o) => inflate(o, CLEARANCE + WINDOW_MARGIN)),
    inflate(problem.from.box, CLEARANCE + WINDOW_MARGIN), inflate(problem.to.box, CLEARANCE + WINDOW_MARGIN)];
  return {
    minX: Math.min(...areas.map((a) => a.minX)),
    minY: Math.min(...areas.map((a) => a.minY)),
    maxX: Math.max(...areas.map((a) => a.maxX)),
    maxY: Math.max(...areas.map((a) => a.maxY)),
  };
}

function rulesFor(problem: Problem, bounds: Bounds, clearance: boolean, separation: boolean): SearchRules {
  return {
    bounds,
    obstacles: clearance ? problem.obstacles.map((o) => inflate(o, CLEARANCE)).filter((o) => intersects(o, bounds)) : [],
    ownBoxes: [inflate(problem.from.box, 0), inflate(problem.to.box, 0)],
    fixed: separation ? problem.fixed.filter((f) => intersects(boundsOfPoints([[f.x1, f.y1], [f.x2, f.y2]]), bounds)) : [],
  };
}

/** Search results keyed by everything a search reads: both ends, the bounds, the obstacles and the fixed segments in them. */
const memo = new Map<string, Point[] | null>();

function memoKey(problem: Problem, rules: SearchRules): string {
  const box = (b: Box) => `${b.x},${b.y},${b.w},${b.h}`;
  const area = (a: Bounds) => `${a.minX},${a.minY},${a.maxX},${a.maxY}`;
  return [
    box(problem.from.box), problem.from.port, problem.from.key, box(problem.to.box), problem.to.port, problem.to.key, area(rules.bounds),
    rules.obstacles.map(area).join(";"), rules.ownBoxes.length,
    rules.fixed.map((f) => `${f.x1},${f.y1},${f.x2},${f.y2},${f.end ?? ""}`).join(";"),
  ].join("|");
}

function cachedSearch(problem: Problem, rules: SearchRules): Point[] | null {
  const key = memoKey(problem, rules);
  const known = memo.get(key);
  if (known !== undefined) return known;
  const route = search(problem, rules);
  if (memo.size > 20000) memo.clear();
  memo.set(key, route);
  return route;
}

/** Routes one connector against obstacles and the fixed routes of lower-id connectors (rules 1 to 7). */
function routeOne(problem: Problem): RouteResult {
  const local = rulesFor(problem, windowAround(problem), true, true);
  const first = cachedSearch(problem, local);
  if (first && bendCount(first) <= 2) return { route: first, blocked: false };
  if (first) {
    // A detour may leave the window: search again over every obstacle the window meets and keep the fewer bends.
    const wider = cachedSearch(problem, rulesFor(problem, reach(problem, local), true, true));
    return { route: wider && bendCount(wider) < bendCount(first) ? wider : first, blocked: false };
  }
  const full = fullBounds(problem);
  const attempts: SearchRules[] = [
    rulesFor(problem, full, true, true),
    rulesFor(problem, windowAround(problem), true, false),
    rulesFor(problem, full, true, false),
  ];
  for (const rules of attempts) {
    const route = cachedSearch(problem, rules);
    if (route) return { route, blocked: false };
  }
  const loose = cachedSearch(problem, rulesFor(problem, full, false, false)) ?? cachedSearch(problem, { ...rulesFor(problem, full, false, false), ownBoxes: [] });
  return { route: loose ?? [portPoint(problem.from.box, problem.from.port), portPoint(problem.to.box, problem.to.port)], blocked: true };
}

function fixedSegments(connector: Connector, route: Point[]): Fixed[] {
  const out: Fixed[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i] as Point;
    const b = route[i + 1] as Point;
    const end = i === 0 ? `${connector.from.shape}:${connector.from.port}` : i === route.length - 2 ? `${connector.to.shape}:${connector.to.port}` : null;
    out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], end });
    if (i === 0 && route.length === 2) out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], end: `${connector.to.shape}:${connector.to.port}` });
  }
  return out;
}

/**
 * Routes every shown connector of the page in id order. Hidden connectors keep their stored route,
 * except a connector that has none yet. Returns the route of every connector on the page.
 */
export function routePage(page: Page): Map<string, RouteResult> {
  const visible = visibleLayerIds(page);
  const byId = new Map<string, Shape>(page.shapes.map((s) => [s.id, s]));
  const obstacles = page.shapes.filter((s) => visible.has(s.layer));
  const fixed: Fixed[] = [];
  const out = new Map<string, RouteResult>();
  const ordered = [...page.connectors].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const connector of ordered) {
    const a = byId.get(connector.from.shape);
    const b = byId.get(connector.to.shape);
    if (!a || !b) continue;
    const shown = isShown(page, connector, visible, byId);
    if (!shown && connector.route.length >= 2) {
      out.set(connector.id, { route: connector.route, blocked: isBlocked(page, connector, connector.route) });
      continue;
    }
    const result = routeOne({
      from: { box: a, port: connector.from.port, key: `${a.id}:${connector.from.port}` },
      to: { box: b, port: connector.to.port, key: `${b.id}:${connector.to.port}` },
      obstacles: obstacles.filter((s) => s.id !== a.id && s.id !== b.id),
      fixed,
    });
    out.set(connector.id, result);
    if (shown) fixed.push(...fixedSegments(connector, result.route));
  }
  return out;
}

/** Rule 6: a route is blocked exactly when it breaks rule 4. */
export function isBlocked(page: Page, connector: Connector, route: Point[]): boolean {
  const visible = visibleLayerIds(page);
  const areas: Bounds[] = [];
  for (const s of page.shapes) {
    if (s.id === connector.from.shape || s.id === connector.to.shape) areas.push(inflate(s, 0));
    else if (visible.has(s.layer)) areas.push(inflate(s, CLEARANCE));
  }
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i] as Point;
    const b = route[i + 1] as Point;
    if (areas.some((area) => segmentHits(area, a[0], a[1], b[0], b[1]))) return true;
  }
  return false;
}

/** The midpoint of the route's longest segment, where a connector label rides. */
export function labelAnchor(route: Point[]): Point {
  let best: Point = route[0] ?? [0, 0];
  let length = -1;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i] as Point;
    const b = route[i + 1] as Point;
    const l = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (l > length) {
      length = l;
      best = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
  }
  return best;
}
