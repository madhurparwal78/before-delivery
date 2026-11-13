import { TOLERANCE, round6 } from './numbers.js';
import type { DrawingModel, Entity, HatchEntity } from './model.js';
import { findLayer } from './model.js';
import {
  type Box,
  type Vec,
  arcSweep,
  boxContains,
  boxOf,
  dist,
  pointAt,
  polygonArea,
  toRad,
  vec,
} from './geometry.js';

export interface Loop {
  handles: string[];
  vertices: Vec[];
  area: number;
  box: Box;
}

const ARC_SAMPLES = 24;
const MAX_CHAIN = 24;

function loopVertices(entity: Entity, reversed: boolean): Vec[] {
  const points: Vec[] = [];
  if (entity.type === 'arc') {
    const centre = vec(entity.cx, entity.cy);
    const sweep = arcSweep(entity.start, entity.end);
    for (let i = 0; i <= ARC_SAMPLES; i += 1) {
      points.push(pointAt(centre, entity.r, entity.start + (sweep * i) / ARC_SAMPLES));
    }
  } else if (entity.type === 'line') {
    points.push(vec(entity.x1, entity.y1), vec(entity.x2, entity.y2));
  }
  return reversed ? points.reverse() : points;
}

function ends(entity: Entity): [Vec, Vec] | null {
  if (entity.type === 'line') return [vec(entity.x1, entity.y1), vec(entity.x2, entity.y2)];
  if (entity.type === 'arc') {
    const centre = vec(entity.cx, entity.cy);
    return [pointAt(centre, entity.r, entity.start), pointAt(centre, entity.r, entity.end)];
  }
  return null;
}

function pointInPolygon(point: Vec, polygon: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function arcLoopArea(handles: string[], model: DrawingModel, chordPolygon: Vec[]): number {
  let area = Math.abs(polygonArea(chordPolygon));
  for (const handle of handles) {
    const entity = model.entities.find((candidate) => candidate.handle === handle);
    if (!entity || entity.type !== 'arc') continue;
    const sweep = toRad(arcSweep(entity.start, entity.end));
    const segment = (entity.r * entity.r) / 2 * (sweep - Math.sin(sweep));
    const centre = vec(entity.cx, entity.cy);
    const mid = pointAt(centre, entity.r, entity.start + arcSweep(entity.start, entity.end) / 2);
    area += pointInPolygon(mid, chordPolygon) ? -segment : segment;
  }
  return area;
}

function closedEntityLoop(entity: Entity): Loop | null {
  if (entity.type === 'circle') {
    const centre = vec(entity.cx, entity.cy);
    const vertices: Vec[] = [];
    for (let i = 0; i < ARC_SAMPLES * 2; i += 1) {
      vertices.push(pointAt(centre, entity.r, (360 * i) / (ARC_SAMPLES * 2)));
    }
    return {
      handles: [entity.handle],
      vertices,
      area: Math.PI * entity.r * entity.r,
      box: boxOf(vertices),
    };
  }
  if (entity.type === 'pline' && entity.closed && entity.points.length >= 3) {
    const vertices = entity.points.map(([x, y]) => vec(x, y));
    return { handles: [entity.handle], vertices, area: Math.abs(polygonArea(vertices)), box: boxOf(vertices) };
  }
  return null;
}

function chainLoops(model: DrawingModel, edges: Entity[]): Loop[] {
  const loops: Loop[] = [];
  const seen = new Set<string>();
  const sameNode = (a: Vec, b: Vec): boolean => dist(a, b) <= TOLERANCE;

  const walk = (startEdge: Entity, startPoint: Vec, currentPoint: Vec, used: Entity[], polyline: Vec[]): void => {
    if (used.length > MAX_CHAIN) return;
    for (const edge of edges) {
      if (used.includes(edge)) continue;
      const edgeEnds = ends(edge);
      if (!edgeEnds) continue;
      const [first, second] = edgeEnds;
      let reversed: boolean | null = null;
      if (sameNode(first, currentPoint)) reversed = false;
      else if (sameNode(second, currentPoint)) reversed = true;
      if (reversed === null) continue;
      const nextPoint = reversed ? first : second;
      const vertices = loopVertices(edge, reversed);
      const nextPolyline = [...polyline, ...vertices.slice(1)];
      const nextUsed = [...used, edge];
      if (sameNode(nextPoint, startPoint) && nextUsed.length >= 3) {
        const key = nextUsed.map((e) => e.handle).sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          const handles = nextUsed.map((e) => e.handle);
          const chordPolygon: Vec[] = [];
          let cursor = startPoint;
          chordPolygon.push(cursor);
          for (const member of nextUsed) {
            const memberEnds = ends(member);
            if (!memberEnds) continue;
            const next = sameNode(memberEnds[0], cursor) ? memberEnds[1] : memberEnds[0];
            chordPolygon.push(next);
            cursor = next;
          }
          chordPolygon.pop();
          loops.push({
            handles,
            vertices: nextPolyline,
            area: arcLoopArea(handles, model, chordPolygon),
            box: boxOf(nextPolyline),
          });
        }
        continue;
      }
      walk(startEdge, startPoint, nextPoint, nextUsed, nextPolyline);
    }
  };

  for (const edge of edges) {
    const edgeEnds = ends(edge);
    if (!edgeEnds) continue;
    walk(edge, edgeEnds[0], edgeEnds[1], [edge], loopVertices(edge, false));
  }
  return loops;
}

/** The entities the boundary search may use: a frozen layer's are ignored, an off layer's are not. */
function boundaryCandidates(model: DrawingModel): Entity[] {
  return model.entities.filter((entity) => {
    const layer = findLayer(model, entity.layer);
    if (layer?.frozen) return false;
    return entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle' || entity.type === 'pline';
  });
}

export interface HatchBoundary {
  boundary: string[];
  islands: string[];
  area: number;
}

/** The smallest closed loop around the point, with its one-level-deep islands. */
export function findHatchBoundary(model: DrawingModel, seed: Vec): HatchBoundary | null {
  const candidates = boundaryCandidates(model);
  const loops: Loop[] = [];
  for (const entity of candidates) {
    const loop = closedEntityLoop(entity);
    if (loop) loops.push(loop);
  }
  const chainEdges = candidates.filter((entity) => entity.type === 'line' || entity.type === 'arc');
  loops.push(...chainLoops(model, chainEdges));

  const containing = loops.filter((loop) => pointInPolygon(seed, loop.vertices));
  if (containing.length === 0) return null;
  let outer = containing[0];
  for (const loop of containing) {
    if (loop.area < outer.area) outer = loop;
  }

  const inside = loops.filter(
    (loop) =>
      loop !== outer &&
      loop.area < outer.area - TOLERANCE &&
      boxContains(outer.box, loop.box) &&
      loop.vertices.every((vertex) => pointInPolygon(vertex, outer.vertices) || outer.vertices.some((v) => dist(v, vertex) <= TOLERANCE)) &&
      !pointInPolygon(seed, loop.vertices),
  );
  const islands = inside.filter(
    (loop) => !inside.some((other) => other !== loop && other.area > loop.area && boxContains(other.box, loop.box)),
  );

  const islandHandles: string[] = [];
  let area = outer.area;
  for (const island of islands) {
    area -= island.area;
    for (const handle of island.handles) if (!islandHandles.includes(handle)) islandHandles.push(handle);
  }
  return { boundary: outer.handles, islands: islandHandles, area: round6(area) };
}

/** Recompute a hatch against current geometry, keeping its last area when the boundary broke. */
export function refreshHatch(model: DrawingModel, hatch: HatchEntity): void {
  const found = findHatchBoundary(model, vec(hatch.seed_x, hatch.seed_y));
  if (!found) {
    hatch.associative = false;
    return;
  }
  hatch.boundary = found.boundary;
  hatch.islands = found.islands;
  hatch.area = found.area;
  hatch.associative = true;
}

export function areaAroundPoint(model: DrawingModel, seed: Vec): number | null {
  const found = findHatchBoundary(model, seed);
  return found ? found.area : null;
}

/** The outline of a boundary, for drawing a hatch. */
export function outlineOf(model: DrawingModel, handles: string[]): Vec[] {
  const entities = handles
    .map((handle) => model.entities.find((candidate) => candidate.handle === handle))
    .filter((entity): entity is Entity => entity !== undefined);
  if (entities.length === 1) {
    const loop = closedEntityLoop(entities[0]);
    if (loop) return loop.vertices;
  }
  const remaining = [...entities];
  const first = remaining.shift();
  if (!first) return [];
  const firstEnds = ends(first);
  if (!firstEnds) return [];
  let cursor = firstEnds[1];
  const vertices: Vec[] = loopVertices(first, false);
  while (remaining.length > 0) {
    const index = remaining.findIndex((entity) => {
      const pair = ends(entity);
      return pair !== null && (dist(pair[0], cursor) <= TOLERANCE || dist(pair[1], cursor) <= TOLERANCE);
    });
    if (index < 0) break;
    const entity = remaining.splice(index, 1)[0];
    const pair = ends(entity);
    if (!pair) break;
    const reversed = dist(pair[1], cursor) <= TOLERANCE;
    vertices.push(...loopVertices(entity, reversed).slice(1));
    cursor = reversed ? pair[0] : pair[1];
  }
  return vertices;
}
