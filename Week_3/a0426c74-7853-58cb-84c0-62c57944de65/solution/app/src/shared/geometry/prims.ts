// The world-space geometry of an entity: hit-test primitives and the bounding box.
import type { BlockDef, DimensionEntity, Entity, HatchEntity, InsertEntity, Point, Rect } from '../types.ts';
import { type Prim, pointRect, primBounds, unionRect } from './curves.ts';
import { type EntityLookup, dimensionLayout } from './dimension.ts';
import { type HatchLoop, type HatchRegion, findHatchRegion } from './hatch.ts';
import { directionDeg } from './numbers.ts';
import { blockChildren, placeChild } from './transform.ts';

interface GeometryContext {
  blocks: Readonly<Record<string, BlockDef>>;
  lookup: EntityLookup;
}

/** The outline of a line, circle, arc or polyline (others have none): cutting edges, boundaries and snaps. */
export function outlinePrims(entity: Entity): Prim[] {
  switch (entity.type) {
    case 'line':
      return [{ kind: 'segment', a: [entity.x1, entity.y1], b: [entity.x2, entity.y2] }];
    case 'circle':
      return [{ kind: 'circle', c: [entity.cx, entity.cy], r: entity.r }];
    case 'arc':
      return [{ kind: 'arc', c: [entity.cx, entity.cy], r: entity.r, start: entity.start, end: entity.end }];
    case 'pline': {
      const ring = entity.closed ? [...entity.points, ...entity.points.slice(0, 1)] : entity.points;
      return ring.slice(1).map((b, i): Prim => ({ kind: 'segment', a: ring[i], b }));
    }
    case 'insert':
    case 'hatch':
    case 'dimension':
      return [];
  }
}

/** The box of what a hatch boundary search reads (lines, arcs, circles, polylines); inserts, dimensions and hatches never matter to it. */
export function outlineBox(entity: Entity): Rect | null {
  const boxes = outlinePrims(entity).map(primBounds);
  return boxes.length === 0 ? null : boxes.reduce(unionRect);
}

/** Primitives of an insert's definition, nested inserts expanded, in world space. */
function insertPrims(insert: InsertEntity, blocks: Readonly<Record<string, BlockDef>>): Prim[] {
  const def = blocks[insert.block];
  if (def === undefined) return [];
  return blockChildren(def).flatMap((child) => {
    const placed = placeChild(child, insert, def);
    return placed.type === 'insert' ? insertPrims(placed, blocks) : outlinePrims(placed);
  });
}

function loopPrims(loop: HatchLoop): Prim[] {
  const prims: Prim[] = [];
  let from: Point = loop.start;
  for (const step of loop.steps) {
    if (step.kind === 'line') prims.push({ kind: 'segment', a: from, b: step.to });
    else {
      const [start, end] = step.ccw ? [from, step.to] : [step.to, from];
      prims.push({ kind: 'arc', c: step.c, r: step.r, start: directionDeg(step.c, start), end: directionDeg(step.c, end) });
    }
    from = step.to;
  }
  return prims;
}

/** The filled region of a hatch from its stored boundary entities; null when the boundary no longer closes (the hatch keeps no shape). */
export function hatchShape(hatch: HatchEntity, lookup: EntityLookup): HatchRegion | null {
  const boundary: Entity[] = [];
  for (const handle of hatch.boundary) {
    const entity = lookup(handle);
    if (entity === undefined) return null;
    boundary.push(entity);
  }
  return findHatchRegion([hatch.seed_x, hatch.seed_y], boundary, {});
}

function hatchPrims(hatch: HatchEntity, lookup: EntityLookup): Prim[] {
  const region = hatchShape(hatch, lookup);
  return region === null ? [] : [region.outer, ...region.islands].flatMap(loopPrims);
}

function dimensionPrims(dimension: DimensionEntity, lookup: EntityLookup): { prims: Prim[]; points: Point[] } {
  const layout = dimensionLayout(dimension, lookup);
  if (layout === null) return { prims: [], points: [[dimension.text_x, dimension.text_y]] };
  const prims: Prim[] = layout.segments.map(([a, b]): Prim => ({ kind: 'segment', a, b }));
  if (layout.arc !== null) prims.push({ kind: 'arc', ...layout.arc });
  return { prims, points: [layout.text] };
}

const unionAll = (rects: Rect[]): Rect => rects.reduce(unionRect);
const extent = (prims: Prim[], fallback: Point): Rect => (prims.length === 0 ? pointRect(fallback) : unionAll(prims.map(primBounds)));

/** Hit-test primitives and the world bounding box: insert = block extent, hatch = its boundary, dimension = drawn lines and text position. */
export function entityGeometry(entity: Entity, context: GeometryContext): { prims: Prim[]; bounds: Rect } {
  switch (entity.type) {
    case 'insert': {
      const prims = insertPrims(entity, context.blocks);
      return { prims, bounds: extent(prims, [entity.x, entity.y]) };
    }
    case 'hatch': {
      const prims = hatchPrims(entity, context.lookup);
      return { prims, bounds: extent(prims, [entity.seed_x, entity.seed_y]) };
    }
    case 'dimension': {
      const { prims, points } = dimensionPrims(entity, context.lookup);
      return { prims, bounds: unionAll([...points.map(pointRect), ...prims.map(primBounds)]) };
    }
    case 'pline':
      return { prims: outlinePrims(entity), bounds: unionAll(entity.points.map(pointRect)) };
    default: {
      const prims = outlinePrims(entity);
      return { prims, bounds: unionAll(prims.map(primBounds)) };
    }
  }
}
