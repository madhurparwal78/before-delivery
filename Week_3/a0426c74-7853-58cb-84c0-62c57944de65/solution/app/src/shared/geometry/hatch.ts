// HATCH: the smallest closed loop around a seed point, its one-level islands, and the area (outer minus islands).
import type { Entity, Layer, Point } from '../types.ts';
import { arcEnds, arcSweep, cross, pointInPolygon } from './curves.ts';
import { RAD, TOL, compareHandles, distance, pointAtAngle } from './numbers.ts';

/** One step of a loop outline: a straight segment or a circular arc travelled counter-clockwise or clockwise. */
type LoopStep =
  | { kind: 'line'; to: Point }
  | { kind: 'arc'; to: Point; c: Point; r: number; ccw: boolean; sweep: number };

export interface HatchLoop {
  /** handles of the entities that form the loop, in handle order */
  handles: string[];
  start: Point;
  steps: LoopStep[];
  /** the outline as a polygon (arcs sampled) for containment tests */
  ring: Point[];
  area: number;
}

export interface HatchRegion { outer: HatchLoop; islands: HatchLoop[]; area: number; boundary: string[] }

const ARC_SAMPLE_DEGREES = 10;
const MAX_CYCLES = 256;
const MAX_SEARCH_STEPS = 200_000;

/** The signed area an outline encloses, exact for arcs (Green's theorem: a bulge outward adds its circular segment, inward subtracts it). */
function outlineArea(start: Point, steps: readonly LoopStep[]): number {
  let twice = 0;
  let from = start;
  for (const step of steps) {
    if (step.kind === 'line') {
      twice += cross(from, step.to);
    } else {
      const sweep = (step.ccw ? 1 : -1) * step.sweep * RAD;
      twice += step.r * step.r * sweep + step.c[0] * (step.to[1] - from[1]) - step.c[1] * (step.to[0] - from[0]);
    }
    from = step.to;
  }
  return twice / 2;
}

function sampleRing(start: Point, steps: readonly LoopStep[]): Point[] {
  const ring: Point[] = [start];
  let from = start;
  for (const step of steps) {
    if (step.kind === 'arc') {
      const first = Math.atan2(from[1] - step.c[1], from[0] - step.c[0]) / RAD;
      const count = Math.max(2, Math.ceil(step.sweep / ARC_SAMPLE_DEGREES));
      for (let i = 1; i < count; i++) ring.push(pointAtAngle(step.c, step.r, first + ((step.ccw ? 1 : -1) * step.sweep * i) / count));
    }
    ring.push(step.to);
    from = step.to;
  }
  return ring;
}

function makeLoop(handles: string[], start: Point, steps: LoopStep[]): HatchLoop {
  return { handles: handles.sort(compareHandles), start, steps, ring: sampleRing(start, steps), area: Math.abs(outlineArea(start, steps)) };
}

function circleLoop(e: Extract<Entity, { type: 'circle' }>): HatchLoop {
  const c: Point = [e.cx, e.cy];
  const west: Point = [e.cx - e.r, e.cy];
  const east: Point = [e.cx + e.r, e.cy];
  return makeLoop([e.handle], east, [{ kind: 'arc', to: west, c, r: e.r, ccw: true, sweep: 180 }, { kind: 'arc', to: east, c, r: e.r, ccw: true, sweep: 180 }]);
}

function polylineLoop(e: Extract<Entity, { type: 'pline' }>): HatchLoop | null {
  const [first, ...rest] = e.points;
  if (first === undefined || rest.length < 2) return null;
  return makeLoop([e.handle], first, [...rest, first].map((to): LoopStep => ({ kind: 'line', to })));
}

interface ChainEdge {
  handle: string;
  from: number;
  to: number;
  /** the step travelling from `from` to `to`, and the reverse */
  forward: LoopStep;
  backward: LoopStep;
}

/** Endpoints within 0.001 of each other are one node. */
class NodeTable {
  private readonly cells = new Map<string, number[]>();
  readonly points: Point[] = [];

  find(p: Point): number {
    const cx = Math.floor(p[0] / TOL);
    const cy = Math.floor(p[1] / TOL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = this.points[id];
          if (distance(q, p) <= TOL) return id;
        }
      }
    }
    const id = this.points.length;
    this.points.push(p);
    const key = `${cx},${cy}`;
    this.cells.set(key, [...(this.cells.get(key) ?? []), id]);
    return id;
  }
}

function chainEdges(entities: readonly Entity[]): { edges: ChainEdge[]; nodes: Point[] } {
  const table = new NodeTable();
  const edges: ChainEdge[] = [];
  for (const e of entities) {
    if (e.type === 'line') {
      const a: Point = [e.x1, e.y1];
      const b: Point = [e.x2, e.y2];
      edges.push({ handle: e.handle, from: table.find(a), to: table.find(b), forward: { kind: 'line', to: b }, backward: { kind: 'line', to: a } });
    } else if (e.type === 'arc') {
      const c: Point = [e.cx, e.cy];
      const [a, b] = arcEnds({ kind: 'arc', c, r: e.r, start: e.start, end: e.end });
      const sweep = arcSweep(e.start, e.end);
      edges.push({
        handle: e.handle, from: table.find(a), to: table.find(b),
        forward: { kind: 'arc', to: b, c, r: e.r, ccw: true, sweep }, backward: { kind: 'arc', to: a, c, r: e.r, ccw: false, sweep },
      });
    }
  }
  return { edges, nodes: table.points };
}

/** Closed chains of lines and arcs: every simple cycle of the endpoint graph (bounded). */
function chainLoops(entities: readonly Entity[]): HatchLoop[] {
  const { edges, nodes } = chainEdges(entities);
  const adjacent: ChainEdge[][] = nodes.map(() => []);
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    adjacent[edge.from].push(edge);
    adjacent[edge.to].push(edge);
  }
  const alive = new Set(edges.filter((edge) => edge.from !== edge.to).map((edge) => edge.handle));
  const degree = (node: number): number => adjacent[node].filter((edge) => alive.has(edge.handle)).length;
  for (let changed = true; changed;) {
    changed = false;
    for (const edge of edges) {
      if (alive.has(edge.handle) && (degree(edge.from) < 2 || degree(edge.to) < 2)) {
        alive.delete(edge.handle);
        changed = true;
      }
    }
  }

  const loops: HatchLoop[] = [];
  const seen = new Set<string>();
  let budget = MAX_SEARCH_STEPS;
  const walk = (origin: number, node: number, used: ChainEdge[], travelled: LoopStep[]): void => {
    for (const edge of adjacent[node]) {
      if (budget-- <= 0 || loops.length >= MAX_CYCLES) return;
      if (!alive.has(edge.handle) || used.includes(edge)) continue;
      const forward = edge.from === node;
      const next = forward ? edge.to : edge.from;
      const step = forward ? edge.forward : edge.backward;
      if (next === origin && used.length >= 1) {
        const handles = [...used, edge].map((e) => e.handle);
        const signature = [...handles].sort().join('|');
        if (!seen.has(signature)) {
          seen.add(signature);
          loops.push(makeLoop(handles, nodes[origin], [...travelled, step]));
        }
      } else if (next > origin) {
        walk(origin, next, [...used, edge], [...travelled, step]);
      }
    }
  };
  for (let origin = 0; origin < nodes.length; origin++) walk(origin, origin, [], []);
  return loops;
}

function loopsOf(entities: readonly Entity[]): HatchLoop[] {
  const loops: HatchLoop[] = [];
  for (const e of entities) {
    if (e.type === 'circle') loops.push(circleLoop(e));
    else if (e.type === 'pline' && e.closed) {
      const loop = polylineLoop(e);
      if (loop !== null) loops.push(loop);
    }
  }
  return [...loops, ...chainLoops(entities)];
}

const insideRing = (ring: readonly Point[], loop: HatchLoop): boolean => loop.ring.every((p) => pointInPolygon(ring, p));

/** The smallest loop around `seed` with its one-level islands, among `entities` (entities on frozen layers ignored). */
export function findHatchRegion(seed: Point, entities: Iterable<Entity>, layers: Readonly<Record<string, Layer>>): HatchRegion | null {
  const usable = [...entities].filter((e) => layers[e.layer]?.frozen !== true);
  const loops = loopsOf(usable);
  let outer: HatchLoop | null = null;
  for (const loop of loops) {
    if (loop.area > 0 && pointInPolygon(loop.ring, seed) && (outer === null || loop.area < outer.area)) outer = loop;
  }
  if (outer === null) return null;
  const enclosing = outer;
  const inside = loops.filter((loop) => loop !== enclosing && !loop.handles.some((h) => enclosing.handles.includes(h)) && insideRing(enclosing.ring, loop));
  const islands = inside.filter((loop) => !inside.some((other) => other !== loop && other.area > loop.area && insideRing(other.ring, loop)));
  return {
    outer,
    islands,
    area: outer.area - islands.reduce((sum, island) => sum + island.area, 0),
    boundary: [...outer.handles, ...islands.flatMap((island) => island.handles)],
  };
}

export interface HatchFind {
  /** handles of the outer loop entities, then the island entities */
  boundary: string[];
  /** the outer loop area less the island areas */
  area: number;
}

/** HATCH: the smallest closed loop around `seed` with its one-level islands; frozen layers are ignored, off layers used. Null when no loop surrounds the seed. */
export function findHatch(seed: Point, entities: Readonly<Record<string, Entity>>, layers: Readonly<Record<string, Layer>>): HatchFind | null {
  const region = findHatchRegion(seed, Object.values(entities), layers);
  return region === null ? null : { boundary: region.boundary, area: region.area };
}
