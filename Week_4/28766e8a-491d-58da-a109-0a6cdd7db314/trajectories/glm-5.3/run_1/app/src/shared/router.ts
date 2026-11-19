import type { Box, Connector, Page, Shape } from './model.js';
import { LIMITS } from './model.js';
import { portPosition, portOutward } from './geometry.js';

export interface RoutePoint { x: number; y: number }
type Vec = { dx: number; dy: number };

export interface RouteResult { route: [number, number][]; blocked: boolean }

const CLEAR = LIMITS.clearance;
const SEP = LIMITS.separation;
const STEM = LIMITS.portStem;

interface Obstacle { x0: number; y0: number; x1: number; y1: number }

function toObstacle(b: Box): Obstacle {
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

interface Seg { horizontal: boolean; fixed: number; lo: number; hi: number }

function segsOf(route: RoutePoint[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    if (a.y === b.y) out.push({ horizontal: true, fixed: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else out.push({ horizontal: false, fixed: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
  }
  return out;
}

/** True when every point of the segment is CLEAR or more from the box. */
function segClearOfRect(seg: Seg, r: Obstacle): boolean {
  if (seg.horizontal) {
    if (seg.hi <= r.x0 || seg.lo >= r.x1) return true;
    const dx = Math.max(r.x0 - seg.hi, seg.lo - r.x1, 0);
    const dy = Math.max(r.y0 - seg.fixed, seg.fixed - r.y1, 0);
    return distanceOk(dx, dy);
  }
  if (seg.hi <= r.y0 || seg.lo >= r.y1) return true;
  const dy = Math.max(r.y0 - seg.hi, seg.lo - r.y1, 0);
  const dx = Math.max(r.x0 - seg.fixed, seg.fixed - r.x1, 0);
  return distanceOk(dx, dy);
}

function distanceOk(dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return false;
  return Math.sqrt(dx * dx + dy * dy) >= CLEAR;
}

/** True when the segment crosses the inside of its own end shape. */
function segCrossesInside(seg: Seg, r: Obstacle): boolean {
  if (seg.horizontal) return seg.hi > r.x0 && seg.lo < r.x1 && seg.fixed > r.y0 && seg.fixed < r.y1;
  return seg.hi > r.y0 && seg.lo < r.y1 && seg.fixed > r.x0 && seg.fixed < r.x1;
}

/** Rules 1 to 4 for the whole route. The first and last segments may run along
 *  their own end shape's edge but never through its inside. */
function routeClear(route: RoutePoint[], obstacles: Obstacle[], from: Obstacle, to: Obstacle): boolean {
  const segs = segsOf(route);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (segCrossesInside(seg, from) || segCrossesInside(seg, to)) return false;
    for (const o of obstacles) if (!segClearOfRect(seg, o)) return false;
  }
  return true;
}

function samePoint(a: RoutePoint, b: RoutePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Rule 7 for a candidate route against the routes already fixed on the page. */
function routeSatisfiesSeparation(route: RoutePoint[], fixed: RoutePoint[][]): boolean {
  const mine = segsOf(route);
  for (const other of fixed) {
    const theirs = segsOf(other);
    const shareFrom = samePoint(route[0]!, other[0]!);
    const shareTo = samePoint(route[route.length - 1]!, other[other.length - 1]!);
    for (let mi = 0; mi < mine.length; mi++) {
      const m = mine[mi]!;
      for (let ti = 0; ti < theirs.length; ti++) {
        const t = theirs[ti]!;
        if (m.horizontal !== t.horizontal) continue;
        const overlap = Math.min(m.hi, t.hi) - Math.max(m.lo, t.lo);
        if (overlap <= 1) continue;
        const dist = Math.abs(m.fixed - t.fixed);
        if (dist >= SEP) continue;
        if (dist === 0) {
          if (shareFrom && mi === 0 && ti === 0 && overlap <= STEM) continue;
          if (shareTo && mi === mine.length - 1 && ti === theirs.length - 1 && overlap <= STEM) continue;
          return false;
        }
        return false;
      }
    }
  }
  return true;
}

export interface RouteSearch {
  fromPort: RoutePoint;
  toPort: RoutePoint;
  fromDir: Vec;
  toDir: Vec;
  obstacles: Obstacle[];
  from: Obstacle;
  to: Obstacle;
}

function stripCollinear(route: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of route) {
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 1]!;
      const b = out[n - 2]!;
      if ((a.x === b.x && a.x === p.x) || (a.y === b.y && a.y === p.y)) out.pop();
    }
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

function pathLength(route: RoutePoint[]): number {
  let length = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    length += Math.abs(route[i]!.x - route[i + 1]!.x) + Math.abs(route[i]!.y - route[i + 1]!.y);
  }
  return length;
}

interface Path { pts: RoutePoint[]; bends: number; length: number }

/**
 * Enumerate orthogonal routes through candidate lines between the two ports.
 * Each route starts at the source port, leaves outward at least STEM units,
 * enters the target port from outside at least STEM units, and turns only on
 * candidate lines. Rules 1-4 are enforced by routeClear; rule 7 is applied
 * afterwards over the routes already fixed on the page.
 */
function searchRoute(search: RouteSearch, fixed: RoutePoint[][]): RoutePoint[] | null {
  const { fromPort, toPort, fromDir, toDir, obstacles, from, to } = search;

  // Candidate turn coordinates: the ports, the port stems, and clear corridors
  // hugging each obstacle on each side.
  const candX = new Set<number>([fromPort.x, toPort.x]);
  const candY = new Set<number>([fromPort.y, toPort.y]);
  for (const o of obstacles) {
    candX.add(o.x0 - CLEAR); candX.add(o.x1 + CLEAR);
    candY.add(o.y0 - CLEAR); candY.add(o.y1 + CLEAR);
    candX.add(o.x0); candX.add(o.x1);
    candY.add(o.y0); candY.add(o.y1);
  }
  candX.add(fromPort.x + fromDir.dx * STEM);
  candX.add(toPort.x + toDir.dx * STEM);
  candY.add(fromPort.y + fromDir.dy * STEM);
  candY.add(toPort.y + toDir.dy * STEM);
  const xs = [...candX];
  const ys = [...candY];

  // The first segment runs along fromDir; the last runs along toDir.
  const sourceLines = fromDir.dx !== 0 ? xs : ys;
  const targetLines = toDir.dx !== 0 ? xs : ys;

  const clearPaths: Path[] = [];
  const seen = new Set<string>();

  const add = (route: RoutePoint[]) => {
    const stripped = stripCollinear(route);
    if (stripped.length < 2) return;
    if (!validStems(stripped, search)) return;
    if (!routeClear(stripped, obstacles, from, to)) return;
    const key = stripped.map((p) => `${p.x},${p.y}`).join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    clearPaths.push({ pts: stripped, bends: stripped.length - 2, length: pathLength(stripped) });
  };

  // Candidate source stem end: every candidate line on the source axis, at
  // least STEM out from the port.
  const sourceStems: RoutePoint[] = (fromDir.dx !== 0 ? xs : ys)
    .filter((v) => (v - (fromDir.dx !== 0 ? fromPort.x : fromPort.y)) * (fromDir.dx !== 0 ? fromDir.dx : fromDir.dy) >= STEM)
    .map((v) => fromDir.dx !== 0
      ? { x: v, y: fromPort.y }
      : { x: fromPort.x, y: v });
  if (sourceStems.length === 0) {
    sourceStems.push({ x: fromPort.x + fromDir.dx * STEM, y: fromPort.y + fromDir.dy * STEM });
  }

  // Enumerate routes by the number of middle turn coordinates: 0, 1, 2.
  for (let turns = 0; turns <= 2; turns++) {
    const enumLines = (idx: number): number[] => {
      // Middle segment `idx` runs along the axis that alternates starting
      // perpendicular to fromDir: the first middle segment is vertical when
      // the source stem was horizontal. A turn on a segment running along an
      // axis fixes a coordinate on that same axis.
      const firstHorizontal = fromDir.dx === 0;
      const horizontal = idx % 2 === 0 ? firstHorizontal : !firstHorizontal;
      return horizontal ? xs : ys;
    };
    const enumerate = (prefix: number[]) => {
      const idx = prefix.length;
      if (idx === turns) {
        for (const stem of sourceStems) {
          const pts: RoutePoint[] = [fromPort, stem];
          let cx = stem.x, cy = stem.y;
          let horizontal = fromDir.dx === 0;
          for (let i = 0; i < turns; i++) {
            const line = prefix[i]!;
            // The current segment runs along `horizontal`; the turn coordinate
            // fixes the next segment's axis.
            const nx = horizontal ? line : cx;
            const ny = horizontal ? cy : line;
            if (nx === cx && ny === cy) continue;
            pts.push({ x: nx, y: ny });
            horizontal = !horizontal;
            cx = nx; cy = ny;
          }
          // Final approach to the target port along toDir. When the current
          // segment already runs along the entry axis, one extra turn aligns
          // the route with the port's entry line first; otherwise the current
          // axis is the perpendicular one and the turn lands on the port's
          // entry line directly.
          const entryHorizontal = toDir.dx !== 0;
          if (horizontal === entryHorizontal) {
            const align: RoutePoint = entryHorizontal
              ? { x: cx, y: toPort.y }
              : { x: toPort.x, y: cy };
            if (align.x === cx && align.y === cy) continue;
            pts.push(align);
          } else {
            const align: RoutePoint = entryHorizontal
              ? { x: cx, y: toPort.y }
              : { x: toPort.x, y: cy };
            if (align.x !== cx || align.y !== cy) pts.push(align);
          }
          pts.push(toPort);
          add(pts);
        }
        return;
      }
      for (const line of enumLines(idx)) {
        enumerate([...prefix, line]);
      }
    };
    enumerate([]);
    if (clearPaths.length > 0 && turns < 2) {
      // Fewer turns can only mean fewer or equal bends; stop at the first
      // turn count that produces at least one clear route.
      break;
    }
  }

  if (clearPaths.length === 0) return null;

  // Rule 5: fewest bends, then shortest length, over routes meeting 1 to 4.
  const byBends = new Map<number, Path[]>();
  for (const p of clearPaths) {
    const list = byBends.get(p.bends);
    if (list) list.push(p); else byBends.set(p.bends, [p]);
  }
  const bendCounts = [...byBends.keys()].sort((a, b) => a - b);

  // Rule 7 over the routes already fixed.
  for (const bends of bendCounts) {
    const candidates = byBends.get(bends)!.sort((a, b) => a.length - b.length);
    for (const c of candidates) {
      if (routeSatisfiesSeparation(c.pts, fixed)) return c.pts;
    }
  }
  // Rule 7 cannot be met while rule 4 holds: rule 4 wins over rule 7, and the
  // connector takes its fewest-bend rule-4 route.
  const minBends = bendCounts[0]!;
  return byBends.get(minBends)!.sort((a, b) => a.length - b.length)[0]!.pts;
}

/** Rule 3: the first segment leaves the source port outward along fromDir for
 *  at least STEM units, and the last enters the target port along toDir for at
 *  least STEM units, both at right angles to their port's edge. */
function validStems(route: RoutePoint[], search: RouteSearch): boolean {
  const { fromPort, toPort, fromDir, toDir } = search;
  if (route.length < 2) return false;
  const first = route[0]!;
  const second = route[1]!;
  if (first.x !== fromPort.x || first.y !== fromPort.y) return false;
  const last = route[route.length - 1]!;
  const before = route[route.length - 2]!;
  if (last.x !== toPort.x || last.y !== toPort.y) return false;
  if (fromDir.dx !== 0) {
    if (first.y !== second.y) return false;
    if (Math.sign(second.x - first.x) !== fromDir.dx) return false;
    if (Math.abs(second.x - first.x) < STEM) return false;
  } else {
    if (first.x !== second.x) return false;
    if (Math.sign(second.y - first.y) !== fromDir.dy) return false;
    if (Math.abs(second.y - first.y) < STEM) return false;
  }
  if (toDir.dx !== 0) {
    if (before.y !== last.y) return false;
    // The entry segment travels opposite to the port's outward direction.
    if (Math.sign(last.x - before.x) !== -toDir.dx) return false;
    if (Math.abs(last.x - before.x) < STEM) return false;
  } else {
    if (before.x !== last.x) return false;
    if (Math.sign(last.y - before.y) !== -toDir.dy) return false;
    if (Math.abs(last.y - before.y) < STEM) return false;
  }
  return true;
}

export function connectorShown(connector: Connector, page: Page, visible: Set<string>): boolean {
  const own = page.layers.find((l) => l.id === connector.layer);
  if (!own || !own.visible) return false;
  const from = page.shapes.find((s) => s.id === connector.from.shape);
  const to = page.shapes.find((s) => s.id === connector.to.shape);
  if (!from || !to) return false;
  return visible.has(from.layer) && visible.has(to.layer);
}

export function computeRoute(
  page: Page,
  connector: Connector,
  visible: Set<string>,
  overrides: Map<string, Box> | undefined,
  fixed: RoutePoint[][],
): RouteResult {
  const fromShape = page.shapes.find((s) => s.id === connector.from.shape);
  const toShape = page.shapes.find((s) => s.id === connector.to.shape);
  if (!fromShape || !toShape) return { route: connector.route, blocked: false };
  const boxOf = (s: Shape): Box => overrides?.get(s.id) ?? { x: s.x, y: s.y, w: s.w, h: s.h };
  const fromBox = boxOf(fromShape);
  const toBox = boxOf(toShape);
  const search: RouteSearch = {
    fromPort: portPosition(fromBox, connector.from.port),
    toPort: portPosition(toBox, connector.to.port),
    fromDir: portOutward(connector.from.port),
    toDir: portOutward(connector.to.port),
    obstacles: page.shapes
      .filter((s) => s.id !== fromShape.id && s.id !== toShape.id && visible.has(s.layer))
      .map((s) => toObstacle(boxOf(s))),
    from: toObstacle(fromBox),
    to: toObstacle(toBox),
  };
  const route = searchRoute(search, fixed);
  if (route === null) return { route: fallbackRoute(search), blocked: true };
  return { route: route.map((p) => [p.x, p.y] as [number, number]), blocked: false };
}

/** Rule 6: fewest-bend route that satisfies rules 1 to 3 only. */
function fallbackRoute(search: RouteSearch): [number, number][] {
  const { fromPort, toPort, fromDir, toDir } = search;
  const stem1: RoutePoint = { x: fromPort.x + fromDir.dx * STEM, y: fromPort.y + fromDir.dy * STEM };
  const stem2: RoutePoint = { x: toPort.x + toDir.dx * STEM, y: toPort.y + toDir.dy * STEM };
  const route: RoutePoint[] = [fromPort, stem1];
  if (fromDir.dx !== 0) route.push({ x: stem1.x, y: stem2.y });
  else route.push({ x: stem2.x, y: stem1.y });
  route.push(stem2, toPort);
  return stripCollinear(route).map((p) => [p.x, p.y] as [number, number]);
}

export function routePage(page: Page, overrides?: Map<string, Box>): { routes: Map<string, RouteResult>; shown: Set<string> } {
  const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
  const connectors = [...page.connectors].sort((a, b) => (a.id < b.id ? -1 : 1));
  const routes = new Map<string, RouteResult>();
  const shown = new Set<string>();
  const fixed: RoutePoint[][] = [];
  for (const connector of connectors) {
    if (!connectorShown(connector, page, visible)) continue;
    const result = computeRoute(page, connector, visible, overrides, fixed);
    routes.set(connector.id, result);
    shown.add(connector.id);
    fixed.push(result.route.map((p) => ({ x: p[0], y: p[1] })));
  }
  return { routes, shown };
}

export function labelAnchor(route: [number, number][]): { x: number; y: number } {
  let bestIndex = 0;
  let bestLength = -1;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (len > bestLength) { bestLength = len; bestIndex = i; }
  }
  const a = route[bestIndex]!;
  const b = route[bestIndex + 1] ?? route[bestIndex]!;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
}

export function routesEqual(a: [number, number][] | undefined, b: [number, number][] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return false;
  }
  return true;
}
