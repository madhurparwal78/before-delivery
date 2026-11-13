// Similarity transforms of any entity: MOVE, ROTATE, SCALE, MIRROR, block insert and xref placement, EXPLODE, ARRAY copies.
import type { BlockDef, Entity, EntityDraft, InsertEntity, Layer, LineEntity, Point } from '../types.ts';
import { RAD, directionDeg, normalizeAngle, rotateAbout, round6 } from './numbers.ts';

export type Transform =
  | { kind: 'translate'; dx: number; dy: number }
  | { kind: 'rotate'; about: Point; degrees: number }
  | { kind: 'scale'; about: Point; factor: number }
  | { kind: 'mirror'; from: Point; to: Point };

/** Insert / xref placement: world = (x, y) + rotate(rotation, scale * (p - base)). */
export interface Placement { x: number; y: number; scale: number; rotation: number }

/** A point map with how it changes lengths and directions: angles become `reflect ? 2 * reflect - a : a + rotation`. */
interface Similarity {
  point: (p: Point) => Point;
  scale: number;
  rotation: number;
  /** direction of the mirror axis, or null when the map keeps handedness */
  reflect: number | null;
}

export function placePoint(p: Point, base: Point, placement: Placement): Point {
  const sim = placementSimilarity(base, placement);
  return sim.point(p);
}

function placementSimilarity(base: Point, placement: Placement): Similarity {
  const origin: Point = [0, 0];
  return {
    point: (p) => {
      const scaled: Point = [(p[0] - base[0]) * placement.scale, (p[1] - base[1]) * placement.scale];
      const rotated = rotateAbout(scaled, origin, placement.rotation);
      return [placement.x + rotated[0], placement.y + rotated[1]];
    },
    scale: placement.scale,
    rotation: placement.rotation,
    reflect: null,
  };
}

function transformSimilarity(transform: Transform): Similarity {
  switch (transform.kind) {
    case 'translate':
      return { point: (p) => [p[0] + transform.dx, p[1] + transform.dy], scale: 1, rotation: 0, reflect: null };
    case 'rotate':
      return { point: (p) => rotateAbout(p, transform.about, transform.degrees), scale: 1, rotation: transform.degrees, reflect: null };
    case 'scale':
      return {
        point: (p) => [transform.about[0] + (p[0] - transform.about[0]) * transform.factor, transform.about[1] + (p[1] - transform.about[1]) * transform.factor],
        scale: transform.factor, rotation: 0, reflect: null,
      };
    case 'mirror': {
      const axis = directionDeg(transform.from, transform.to);
      return {
        point: (p) => {
          const dx = p[0] - transform.from[0];
          const dy = p[1] - transform.from[1];
          const cos = Math.cos(2 * axis * RAD);
          const sin = Math.sin(2 * axis * RAD);
          return [transform.from[0] + dx * cos + dy * sin, transform.from[1] + dx * sin - dy * cos];
        },
        scale: 1, rotation: 0, reflect: axis,
      };
    }
  }
}

function mapAngle(sim: Similarity, degrees: number): number {
  return normalizeAngle(sim.reflect === null ? degrees + sim.rotation : 2 * sim.reflect - degrees);
}

function roundedPoint(sim: Similarity, p: Point): Point {
  const mapped = sim.point(p);
  return [round6(mapped[0]), round6(mapped[1])];
}

function mapEntity(entity: Entity, sim: Similarity): Entity {
  switch (entity.type) {
    case 'line': {
      const [x1, y1] = roundedPoint(sim, [entity.x1, entity.y1]);
      const [x2, y2] = roundedPoint(sim, [entity.x2, entity.y2]);
      return { ...entity, x1, y1, x2, y2 };
    }
    case 'circle': {
      const [cx, cy] = roundedPoint(sim, [entity.cx, entity.cy]);
      return { ...entity, cx, cy, r: round6(entity.r * sim.scale) };
    }
    case 'arc': {
      const [cx, cy] = roundedPoint(sim, [entity.cx, entity.cy]);
      const start = round6(mapAngle(sim, sim.reflect === null ? entity.start : entity.end));
      const end = round6(mapAngle(sim, sim.reflect === null ? entity.end : entity.start));
      return { ...entity, cx, cy, r: round6(entity.r * sim.scale), start, end };
    }
    case 'pline':
      return { ...entity, points: entity.points.map((p) => roundedPoint(sim, p)) };
    case 'insert': {
      const [x, y] = roundedPoint(sim, [entity.x, entity.y]);
      const rotation = sim.rotation === 0 && sim.reflect === null ? entity.rotation : round6(mapAngle(sim, entity.rotation));
      return { ...entity, x, y, scale: round6(entity.scale * sim.scale), rotation };
    }
    case 'hatch': {
      const [seed_x, seed_y] = roundedPoint(sim, [entity.seed_x, entity.seed_y]);
      return { ...entity, seed_x, seed_y };
    }
    case 'dimension': {
      const [text_x, text_y] = roundedPoint(sim, [entity.text_x, entity.text_y]);
      return { ...entity, text_x, text_y };
    }
  }
}

/** The entity moved, rotated, scaled or mirrored (arc start/end swap; insert position and rotation; hatch seed; dimension text), same handle. */
export function transformEntity(entity: Entity, transform: Transform): Entity {
  return mapEntity(entity, transformSimilarity(transform));
}

/** The entity as drawn by a placement (block insert or xref): world = (x, y) + rotate(rotation, scale * (p - base)). */
export function placeEntity(entity: Entity, base: Point, placement: Placement): Entity {
  return mapEntity(entity, placementSimilarity(base, placement));
}

/** The fields of `after` that differ from `before` (the `set` of a modify operation). */
export function changedFields(before: Entity, after: Entity): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const previous: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) changes[key] = value;
  }
  return changes;
}

/** The two end points of a line. */
export const lineEnds = (line: LineEntity): [Point, Point] => [[line.x1, line.y1], [line.x2, line.y2]];

/** The line with new end points, rounded to the stored 6 decimals. */
export function withEnds(line: LineEntity, a: Point, b: Point): LineEntity {
  return { ...line, x1: round6(a[0]), y1: round6(a[1]), x2: round6(b[0]), y2: round6(b[1]) };
}

export function withoutHandle(entity: Entity): EntityDraft {
  const { handle: _handle, ...draft } = entity;
  return draft;
}

/** The effective colour name of an entity on `layer`: ByLayer and an unresolved ByBlock take the layer's colour. */
export function effectiveColour(colour: Entity['colour'], layer: Layer): Layer['colour'] {
  return colour === undefined || colour === 'ByLayer' || colour === 'ByBlock' ? layer.colour : colour;
}

/** The geometry entities of a block definition (a hatch or dimension follows entities of the drawing, not of a definition). */
export function blockChildren(def: BlockDef): Entity[] {
  return def.entities.filter((e) => e.type !== 'hatch' && e.type !== 'dimension');
}

function insertSimilarity(insert: InsertEntity, def: BlockDef): Similarity {
  return placementSimilarity(def.base, insert);
}

/** The colour a block definition entity inherits from its insert: ByBlock on layer `0` takes the insert's effective colour. */
export function childColour(child: Entity, insertColour: Layer['colour']): Entity['colour'] {
  return child.colour === 'ByBlock' && child.layer === '0' ? insertColour : child.colour;
}

/** A definition entity placed in the frame the insert's own entity lives in. */
export function placeChild(child: Entity, insert: InsertEntity, def: BlockDef): Entity {
  return mapEntity(child, insertSimilarity(insert, def));
}

/** EXPLODE: the insert's definition entities at their drawn positions (nested inserts stay inserts), ByBlock colour resolved, no handles. */
export function explodeInsert(insert: InsertEntity, blocks: Readonly<Record<string, BlockDef>>, layers: Readonly<Record<string, Layer>>): EntityDraft[] {
  const def = blocks[insert.block];
  const layer = layers[insert.layer];
  if (def === undefined || layer === undefined) return [];
  const insertColour = effectiveColour(insert.colour, layer);
  return blockChildren(def).map((child) => {
    const placed = placeChild(child, insert, def);
    const colour = childColour(child, insertColour);
    return withoutHandle(colour === undefined ? placed : { ...placed, colour });
  });
}

/** Blocks rule: the chain `[name, ..., name]` when a definition of `name` holding `entities` would contain itself, else null. */
export function findBlockCycle(name: string, entities: readonly Entity[], blocks: Readonly<Record<string, BlockDef>>): string[] | null {
  const visit = (children: readonly Entity[], path: string[]): string[] | null => {
    for (const child of children) {
      if (child.type !== 'insert') continue;
      if (child.block === name) return [...path, name];
      const def = blocks[child.block];
      if (def === undefined || path.includes(child.block)) continue;
      const found = visit(def.entities, [...path, child.block]);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(entities, [name]);
}
