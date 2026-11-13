import { ApiError, MESSAGES } from '../shared/errors.js';
import {
  LAYER_COLOURS,
  LINETYPES,
  LINEWEIGHTS,
  type DimRef,
  type DimensionKind,
  type LayerColour,
  type Linetype,
  type Lineweight,
} from '../shared/model.js';
import { CONSTRAINT_KINDS } from '../shared/commands.js';
import type { ConstraintKind, ConstraintRef } from '../shared/model.js';
import type { EntityInput, LayerSet, ModifySet, Operation } from '../shared/operations.js';

function bad(message = MESSAGES.invalid): ApiError {
  return new ApiError('invalid', message);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw bad();
  return value as Record<string, unknown>;
}

function str(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string') throw bad();
  return value;
}

function optionalStr(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw bad();
  return value;
}

function num(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw bad();
  return value;
}

function optionalNum(source: Record<string, unknown>, field: string, fallback: number): number {
  const value = source[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw bad();
  return value;
}

function bool(source: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = source[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw bad();
  return value;
}

function points(value: unknown): [number, number][] {
  if (!Array.isArray(value)) throw bad();
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number' || typeof entry[1] !== 'number') throw bad();
    return [entry[0], entry[1]] as [number, number];
  });
}

function stringMap(value: unknown): Record<string, string> {
  const source = record(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry !== 'string') throw bad();
    out[key] = entry;
  }
  return out;
}

function dimRefs(value: unknown): DimRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = record(entry);
    const point = optionalStr(source, 'point');
    return {
      handle: str(source, 'handle'),
      point: point === 'start' || point === 'end' || point === 'centre' ? point : null,
    };
  });
}

function constraintRefs(value: unknown): ConstraintRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = record(entry);
    const point = optionalStr(source, 'point');
    return { handle: str(source, 'handle'), point: point === 'start' || point === 'end' ? point : null };
  });
}

function colour(value: string): LayerColour {
  if (!(LAYER_COLOURS as string[]).includes(value)) throw bad();
  return value as LayerColour;
}

function linetype(value: string): Linetype {
  if (!(LINETYPES as string[]).includes(value)) throw bad();
  return value as Linetype;
}

function lineweight(value: string): Lineweight {
  if (!(LINEWEIGHTS as string[]).includes(value)) throw bad();
  return value as Lineweight;
}

export function parseEntityInput(value: unknown): EntityInput {
  const source = record(value);
  const common = {
    handle: optionalStr(source, 'handle'),
    layer: optionalStr(source, 'layer') ?? '0',
    colour: optionalStr(source, 'colour'),
    linetype: optionalStr(source, 'linetype'),
    lineweight: optionalStr(source, 'lineweight'),
  };
  const type = str(source, 'type');
  switch (type) {
    case 'line':
      return { ...common, type, x1: num(source, 'x1'), y1: num(source, 'y1'), x2: num(source, 'x2'), y2: num(source, 'y2') };
    case 'circle':
      return { ...common, type, cx: num(source, 'cx'), cy: num(source, 'cy'), r: num(source, 'r') };
    case 'arc':
      return {
        ...common,
        type,
        cx: num(source, 'cx'),
        cy: num(source, 'cy'),
        r: num(source, 'r'),
        start: num(source, 'start'),
        end: num(source, 'end'),
      };
    case 'pline':
      return { ...common, type, points: points(source.points), closed: bool(source, 'closed', false) };
    case 'insert':
      return {
        ...common,
        type,
        block: str(source, 'block'),
        x: num(source, 'x'),
        y: num(source, 'y'),
        scale: optionalNum(source, 'scale', 1),
        rotation: optionalNum(source, 'rotation', 0),
        attributes: source.attributes === undefined ? {} : stringMap(source.attributes),
      };
    case 'hatch':
      return { ...common, type, seed_x: num(source, 'seed_x'), seed_y: num(source, 'seed_y') };
    case 'dimension': {
      const kind = str(source, 'kind');
      if (!['linear', 'aligned', 'angular', 'radial'].includes(kind)) throw bad();
      return {
        ...common,
        type,
        kind: kind as DimensionKind,
        style: optionalStr(source, 'style') ?? 'Standard',
        refs: dimRefs(source.refs),
        points: source.points === undefined ? [] : points(source.points),
        override: optionalStr(source, 'override') ?? null,
        text_x: num(source, 'text_x'),
        text_y: num(source, 'text_y'),
      };
    }
    default:
      throw bad();
  }
}

function parseModifySet(value: unknown): ModifySet {
  const source = record(value);
  const set: ModifySet = {};
  const numberFields: (keyof ModifySet)[] = [
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'start',
    'end',
    'x',
    'y',
    'scale',
    'rotation',
    'seed_x',
    'seed_y',
    'text_x',
    'text_y',
  ];
  for (const field of numberFields) {
    const entry = source[field as string];
    if (entry === undefined) continue;
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw bad();
    (set as Record<string, number>)[field as string] = entry;
  }
  for (const field of ['layer', 'colour', 'linetype', 'lineweight', 'block', 'style'] as const) {
    const entry = source[field];
    if (entry === undefined) continue;
    if (typeof entry !== 'string') throw bad();
    set[field] = entry;
  }
  if (source.override !== undefined) set.override = source.override === null ? null : str(source, 'override');
  if (source.closed !== undefined) set.closed = bool(source, 'closed', false);
  if (source.points !== undefined) set.points = points(source.points);
  if (source.attributes !== undefined) set.attributes = stringMap(source.attributes);
  if (source.refs !== undefined) set.refs = dimRefs(source.refs);
  return set;
}

function parseLayerSet(value: unknown): LayerSet {
  const source = record(value);
  const set: LayerSet = {};
  if (source.on !== undefined) set.on = bool(source, 'on', true);
  if (source.frozen !== undefined) set.frozen = bool(source, 'frozen', false);
  if (source.locked !== undefined) set.locked = bool(source, 'locked', false);
  if (source.colour !== undefined) set.colour = colour(str(source, 'colour'));
  if (source.linetype !== undefined) set.linetype = linetype(str(source, 'linetype'));
  if (source.lineweight !== undefined) set.lineweight = lineweight(str(source, 'lineweight'));
  if (source.rename !== undefined) set.rename = str(source, 'rename');
  return set;
}

function handles(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad();
  return value.map((entry) => {
    if (typeof entry !== 'string') throw bad();
    return entry;
  });
}

export function parseOperation(value: unknown, fallbackId: () => string): Operation {
  const source = record(value);
  const opId = optionalStr(source, 'op_id') ?? fallbackId();
  const type = str(source, 'type');
  switch (type) {
    case 'add':
      return { op_id: opId, type, entity: parseEntityInput(source.entity) };
    case 'modify':
      return { op_id: opId, type, handle: str(source, 'handle'), set: parseModifySet(source.set) };
    case 'move':
      return { op_id: opId, type, handles: handles(source.handles), dx: num(source, 'dx'), dy: num(source, 'dy') };
    case 'delete':
      return { op_id: opId, type, handles: handles(source.handles) };
    case 'layer_add':
      return {
        op_id: opId,
        type,
        name: str(source, 'name'),
        colour: colour(optionalStr(source, 'colour') ?? 'white'),
        linetype: linetype(optionalStr(source, 'linetype') ?? 'Continuous'),
        lineweight: lineweight(optionalStr(source, 'lineweight') ?? '0.25'),
      };
    case 'layer_set':
      return { op_id: opId, type, name: str(source, 'name'), set: parseLayerSet(source.set) };
    case 'layer_delete':
    case 'layer_state_save':
    case 'layer_state_restore':
    case 'xref_reload':
    case 'xref_bind':
    case 'parameter_delete':
      return { op_id: opId, type, name: str(source, 'name') };
    case 'block_define': {
      const base = points([source.base])[0];
      const attributes = Array.isArray(source.attributes)
        ? source.attributes.map((entry) => {
            const attribute = record(entry);
            return { tag: str(attribute, 'tag'), default: optionalStr(attribute, 'default') ?? '' };
          })
        : [];
      return {
        op_id: opId,
        type,
        name: str(source, 'name'),
        base,
        handles: handles(source.handles ?? []),
        attributes,
      };
    }
    case 'explode':
      return { op_id: opId, type, handle: str(source, 'handle') };
    case 'purge':
      return { op_id: opId, type };
    case 'dim_style_set':
      return {
        op_id: opId,
        type,
        name: str(source, 'name'),
        precision: optionalNum(source, 'precision', 2),
        prefix: optionalStr(source, 'prefix') ?? '',
        suffix: optionalStr(source, 'suffix') ?? '',
        scale: optionalNum(source, 'scale', 1),
        text_height_mm: optionalNum(source, 'text_height_mm', 2.5),
      };
    case 'constraint_add': {
      const kind = str(source, 'kind');
      if (!(CONSTRAINT_KINDS as readonly string[]).includes(kind)) throw bad();
      return {
        op_id: opId,
        type,
        kind: kind as ConstraintKind,
        refs: constraintRefs(source.refs),
        expression: optionalStr(source, 'expression') ?? null,
      };
    }
    case 'constraint_delete':
      return { op_id: opId, type, id: str(source, 'id') };
    case 'parameter_set':
      return { op_id: opId, type, name: str(source, 'name'), expression: str(source, 'expression') };
    case 'xref_attach':
      return {
        op_id: opId,
        type,
        name: str(source, 'name'),
        source: str(source, 'source'),
        x: optionalNum(source, 'x', 0),
        y: optionalNum(source, 'y', 0),
        scale: optionalNum(source, 'scale', 1),
        rotation: optionalNum(source, 'rotation', 0),
      };
    case 'xref_clip': {
      const rect = source.rect;
      if (rect === null || rect === undefined) return { op_id: opId, type, name: str(source, 'name'), rect: null };
      if (!Array.isArray(rect) || rect.length !== 4 || rect.some((entry) => typeof entry !== 'number')) throw bad();
      return {
        op_id: opId,
        type,
        name: str(source, 'name'),
        rect: [rect[0] as number, rect[1] as number, rect[2] as number, rect[3] as number],
      };
    }
    case 'version_restore':
      return { op_id: opId, type, version: str(source, 'version') };
    case 'import_merge':
      return { op_id: opId, type, import_id: str(source, 'import_id') };
    default:
      throw bad();
  }
}

export function parseOperations(value: unknown, fallbackId: () => string): Operation[] {
  if (!Array.isArray(value)) throw bad();
  return value.map((entry) => parseOperation(entry, fallbackId));
}
