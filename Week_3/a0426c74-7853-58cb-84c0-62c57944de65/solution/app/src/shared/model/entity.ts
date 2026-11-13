// Entities: reading a loose draft into a typed one, and building the stored entity from a draft against the drawing's state.
import * as copy from '../copy.ts';
import { fieldError, invalid } from '../errors.ts';
import { COLOURS, DIMENSION_KINDS, ENTITY_TYPES, LINETYPES, LINEWEIGHTS } from '../types.ts';
import type { BlockAttribute, Entity, EntityDraft, EntityType, Point } from '../types.ts';
import { dimensionValue, findHatch, normalizeAngle, round6 } from '../geometry/index.ts';
import type { Context } from './context.ts';
import { readBoolean, readList, readNumber, readOneOf, readPoint, readRecord, readString } from './read.ts';
import type { Json } from './read.ts';

const COMMON_KEYS = ['layer', 'colour', 'linetype', 'lineweight'];
/** The fields a `modify` may set, per type. Derived fields (area, value, associative, boundary) are never set by hand. */
const SETTABLE: Record<EntityType, readonly string[]> = {
  line: ['x1', 'y1', 'x2', 'y2'],
  circle: ['cx', 'cy', 'r'],
  arc: ['cx', 'cy', 'r', 'start', 'end'],
  pline: ['points', 'closed'],
  insert: ['x', 'y', 'scale', 'rotation', 'block', 'attributes'],
  hatch: ['seed_x', 'seed_y'],
  dimension: ['kind', 'style', 'refs', 'override', 'text_x', 'text_y'],
};

export function assertSettable(type: EntityType, set: Json): void {
  for (const key of Object.keys(set)) {
    if (!COMMON_KEYS.includes(key) && !SETTABLE[type].includes(key)) throw invalid(copy.unknownField(key));
  }
}

function attributeValues(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(readRecord(value, field)).map(([tag, v]) => [tag, readString(v, `${field}.${tag}`)]));
}

/** Reads the fields of an entity (an `add` draft, a seed or file record, or a stored entity with a `modify` set applied) into a typed draft. */
export function readDraft(value: unknown, field = 'entity'): EntityDraft {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  const num = (key: string): number => readNumber(json[key], at(key));
  const type = readOneOf(json.type, at('type'), ENTITY_TYPES);
  const common = {
    layer: readString(json.layer, at('layer')),
    ...(json.colour === undefined ? {} : { colour: readOneOf(json.colour, at('colour'), [...COLOURS, 'ByLayer', 'ByBlock'] as const) }),
    ...(json.linetype === undefined ? {} : { linetype: readOneOf(json.linetype, at('linetype'), [...LINETYPES, 'ByLayer'] as const) }),
    ...(json.lineweight === undefined ? {} : { lineweight: readOneOf(json.lineweight, at('lineweight'), [...LINEWEIGHTS, 'ByLayer'] as const) }),
  };
  switch (type) {
    case 'line': return { ...common, type, x1: num('x1'), y1: num('y1'), x2: num('x2'), y2: num('y2') };
    case 'circle': return { ...common, type, cx: num('cx'), cy: num('cy'), r: num('r') };
    case 'arc': return { ...common, type, cx: num('cx'), cy: num('cy'), r: num('r'), start: num('start'), end: num('end') };
    case 'pline': {
      const points: Point[] = readList(json.points, at('points')).map((p) => readPoint(p, at('points')));
      if (points.length < 2) throw fieldError(at('points'));
      return { ...common, type, points, closed: readBoolean(json.closed, at('closed')) };
    }
    case 'insert':
      return {
        ...common, type, block: readString(json.block, at('block')), x: num('x'), y: num('y'), scale: num('scale'), rotation: num('rotation'),
        attributes: attributeValues(json.attributes, at('attributes')),
      };
    case 'hatch': return { ...common, type, seed_x: num('seed_x'), seed_y: num('seed_y') };
    case 'dimension': {
      const refs = readList(json.refs, at('refs')).map((r) => {
        const ref = readRecord(r, at('refs'));
        const point = ref.point === undefined || ref.point === null ? null : readOneOf(ref.point, at('refs'), ['start', 'end', 'centre'] as const);
        return { handle: readString(ref.handle, at('refs')), point };
      });
      if (refs.length === 0) throw fieldError(at('refs'));
      return {
        ...common, type, kind: readOneOf(json.kind, at('kind'), DIMENSION_KINDS), style: readString(json.style, at('style')), refs,
        override: json.override === undefined || json.override === null ? null : readString(json.override, at('override')),
        text_x: num('text_x'), text_y: num('text_y'),
      };
    }
  }
}

/** Each tag of the definition with the given value, else the definition's default; other tags are dropped. */
export function completeAttributes(tags: readonly BlockAttribute[], given: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(tags.map((attribute) => [attribute.tag, given[attribute.tag] ?? attribute.default]));
}

function positive(value: number): number {
  const rounded = round6(value);
  if (rounded <= 0) throw invalid(copy.NUMBER_ABOVE_ZERO);
  return rounded;
}

/**
 * The stored entity for `draft`. Numbers are rounded to 6 decimals, arc angles normalised, an insert gets its attributes completed from the block
 * definition, a dimension its value and a hatch its boundary. `carried` is the stored entity a `modify` starts from (or an import's provisional
 * entity): its dimension value and association, or hatch boundary and area, are kept for the derive step to refresh.
 */
export function buildEntity(ctx: Context, draft: EntityDraft, handle: string, author: string | null, carried?: Entity): Entity {
  if (!ctx.ws.layers.has(draft.layer)) throw invalid(copy.noLayer(draft.layer));
  const common = {
    handle, layer: draft.layer, author,
    ...(draft.colour === undefined ? {} : { colour: draft.colour }),
    ...(draft.linetype === undefined ? {} : { linetype: draft.linetype }),
    ...(draft.lineweight === undefined ? {} : { lineweight: draft.lineweight }),
  };
  switch (draft.type) {
    case 'line': return { ...common, type: 'line', x1: round6(draft.x1), y1: round6(draft.y1), x2: round6(draft.x2), y2: round6(draft.y2) };
    case 'circle': return { ...common, type: 'circle', cx: round6(draft.cx), cy: round6(draft.cy), r: positive(draft.r) };
    case 'arc':
      return {
        ...common, type: 'arc', cx: round6(draft.cx), cy: round6(draft.cy), r: positive(draft.r),
        start: round6(normalizeAngle(draft.start)), end: round6(normalizeAngle(draft.end)),
      };
    case 'pline': return { ...common, type: 'pline', points: draft.points.map((p): Point => [round6(p[0]), round6(p[1])]), closed: draft.closed };
    case 'insert': {
      const definition = ctx.ws.blocks.get(draft.block);
      if (!definition) throw invalid(copy.noBlock(draft.block));
      return {
        ...common, type: 'insert', block: draft.block, x: round6(draft.x), y: round6(draft.y), scale: positive(draft.scale),
        rotation: round6(draft.rotation), attributes: completeAttributes(definition.attributes, draft.attributes),
      };
    }
    case 'hatch': {
      const seed_x = round6(draft.seed_x);
      const seed_y = round6(draft.seed_y);
      if (carried?.type === 'hatch') return { ...common, type: 'hatch', seed_x, seed_y, area: carried.area, associative: carried.associative, boundary: carried.boundary };
      const found = findHatch([seed_x, seed_y], ctx.ws.entities.record, ctx.ws.layers.record);
      if (found === null) throw invalid(copy.NO_BOUNDARY);
      return { ...common, type: 'hatch', seed_x, seed_y, area: found.area, associative: true, boundary: found.boundary };
    }
    case 'dimension': {
      const style = ctx.ws.dimStyles.get(draft.style);
      if (!style) throw invalid(copy.noDimStyle(draft.style));
      for (const ref of draft.refs) {
        if (!ctx.ws.entities.has(ref.handle)) throw invalid(copy.noEntity(ref.handle));
      }
      const value = carried?.type === 'dimension' ? carried.value : dimensionValue(draft, ctx.ws.entities.record, style);
      if (value === null) throw fieldError('refs');
      return {
        ...common, type: 'dimension', kind: draft.kind, style: draft.style, refs: draft.refs, override: draft.override,
        text_x: round6(draft.text_x), text_y: round6(draft.text_y), value, associative: carried?.type === 'dimension' ? carried.associative : true,
      };
    }
  }
}
