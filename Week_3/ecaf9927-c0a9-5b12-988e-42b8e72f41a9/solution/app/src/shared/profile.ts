import type { Entity, Point2 } from './api';

/** Full circles are faceted into this many sides; arcs get the same density per turn. */
const SEGMENTS_PER_TURN = 256;
const TURN = 2 * Math.PI;
const RAD = Math.PI / 180;

type Segment = Extract<Entity, { type: 'line' | 'arc' }>;

function sweepOf(arc: Extract<Entity, { type: 'arc' }>): number {
  const sweep = ((arc.end_angle_deg - arc.start_angle_deg) * RAD) % TURN;
  return sweep > 0 ? sweep : sweep + TURN;
}

/** Points along a segment from its start to its end, the end excluded; `reversed` walks it backwards. */
function trace(segment: Segment, reversed: boolean): Point2[] {
  if (segment.type === 'line') return [reversed ? segment.end : segment.start];
  const sweep = sweepOf(segment);
  const steps = Math.max(8, Math.ceil((SEGMENTS_PER_TURN * sweep) / TURN));
  const from = segment.start_angle_deg * RAD;
  const points: Point2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = from + (reversed ? sweep - (sweep * i) / steps : (sweep * i) / steps);
    points.push({ x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) });
  }
  return points;
}

function circlePolygon(center: Point2, radius: number): Point2[] {
  return Array.from({ length: SEGMENTS_PER_TURN }, (_, i) => {
    const angle = (TURN * i) / SEGMENTS_PER_TURN;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function crossing(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const side = (p: Point2, q: Point2, r: Point2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const eps = 1e-9;
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

function area(loop: readonly Point2[]): number {
  return loop.reduce((sum, p, i) => {
    const q = loop[(i + 1) % loop.length] as Point2;
    return sum + (p.x * q.y - q.x * p.y) / 2;
  }, 0);
}

function loopsCross(loops: readonly Point2[][]): boolean {
  const edges = loops.flatMap((loop, li) =>
    loop.map((p, i) => ({ li, i, a: p, b: loop[(i + 1) % loop.length] as Point2, n: loop.length })),
  );
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as (typeof edges)[number];
    for (let j = i + 1; j < edges.length; j++) {
      const f = edges[j] as (typeof edges)[number];
      if (e.li === f.li && (f.i === (e.i + 1) % e.n || e.i === (f.i + 1) % f.n)) continue;
      if (Math.max(e.a.x, e.b.x) < Math.min(f.a.x, f.b.x) || Math.max(f.a.x, f.b.x) < Math.min(e.a.x, e.b.x)) continue;
      if (Math.max(e.a.y, e.b.y) < Math.min(f.a.y, f.b.y) || Math.max(f.a.y, f.b.y) < Math.min(e.a.y, e.b.y)) continue;
      if (crossing(e.a, e.b, f.a, f.b)) return true;
    }
  }
  return false;
}

/**
 * The closed loops of a sketch, or undefined when the profile is not closed.
 * Every line and arc endpoint must be coincident with exactly one other endpoint, the joins must form loops,
 * and no two edges may cross. A circle is a loop by itself; point entities are ignored.
 */
export function closedLoops(entities: readonly Entity[], constraints: readonly { kind: string; refs: readonly string[] }[]): Point2[][] | undefined {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    const p = parent.get(a) ?? a;
    if (p === a) return a;
    const root = find(p);
    parent.set(a, root);
    return root;
  };
  for (const c of constraints) if (c.kind === 'coincident') parent.set(find(c.refs[0] as string), find(c.refs[1] as string));

  const segments = entities.filter((e): e is Segment => e.type === 'line' || e.type === 'arc');
  const ends = new Map<string, { segment: Segment; end: 'start' | 'end' }[]>();
  for (const segment of segments) {
    for (const end of ['start', 'end'] as const) {
      const key = find(`${segment.id}.${end}`);
      ends.set(key, [...(ends.get(key) ?? []), { segment, end }]);
    }
  }
  if ([...ends.values()].some((group) => group.length !== 2)) return undefined;

  const loops: Point2[][] = [];
  const visited = new Set<string>();
  for (const first of segments) {
    if (visited.has(first.id)) continue;
    const loop: Point2[] = [];
    let segment = first;
    let reversed = false;
    for (let guard = 0; guard <= segments.length; guard++) {
      visited.add(segment.id);
      loop.push(...trace(segment, reversed));
      const exit: string = `${segment.id}.${reversed ? 'start' : 'end'}`;
      const next: { segment: Segment; end: 'start' | 'end' } | undefined = (ends.get(find(exit)) ?? []).find(
        (e) => `${e.segment.id}.${e.end}` !== exit,
      );
      if (!next) return undefined;
      if (next.segment.id === first.id) break;
      if (visited.has(next.segment.id)) return undefined;
      segment = next.segment;
      reversed = next.end === 'end';
    }
    loops.push(loop);
  }
  for (const circle of entities) if (circle.type === 'circle') loops.push(circlePolygon(circle.center, circle.radius));
  if (loops.length === 0 || loops.some((loop) => loop.length < 3 || Math.abs(area(loop)) < 1e-9) || loopsCross(loops)) return undefined;
  return loops;
}

/** Whether `point` lies inside `loop` (even-odd ray casting). */
function contains(loop: readonly Point2[], point: Point2): boolean {
  let inside = false;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length] as Point2;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  });
  return inside;
}

/** Area of the region inside the loops, with loops nested inside another treated as holes (alternating inside and outside). */
export function profileArea(loops: readonly Point2[][]): number {
  return loops.reduce((sum, loop, i) => {
    const depth = loops.filter((other, j) => j !== i && contains(other, loop[0] as Point2)).length;
    return sum + (depth % 2 === 0 ? 1 : -1) * Math.abs(area(loop));
  }, 0);
}
