// The boundary with JSON: operation groups and seed records arrive as `unknown` and leave as typed values. Rule checks that need the
// drawing's state stay in the engine; this only checks shape and the lists of allowed words.
import { fieldError } from '../errors.ts';
import { COLOURS, CONSTRAINT_KINDS, LINETYPES, LINEWEIGHTS } from '../types.ts';
import type {
  BlockAttribute, Constraint, ConstraintRef, DimStyle, Layer, Op, OperationGroup, Parameter, Rect,
} from '../types.ts';
import { readDraft } from './entity.ts';
import type { DrawingSeed, SeedBlock, SeedEntity } from './index.ts';
import {
  optional, readBoolean, readList, readNumber, readOneOf, readPoint, readRecord, readString,
} from './read.ts';
import type { Json } from './read.ts';

const strings = (value: unknown, field: string): string[] => readList(value, field).map((item) => readString(item, field));
const rect = (value: unknown, field: string): Rect => {
  const [x1, y1, x2, y2] = readList(value, field).map((item) => readNumber(item, field));
  if (y2 === undefined) throw fieldError(field);
  return [x1, y1, x2, y2];
};

function attributes(value: unknown, field: string): BlockAttribute[] {
  return readList(value, field).map((item) => {
    const json = readRecord(item, field);
    return { tag: readString(json.tag, field), default: readString(json.default, field) };
  });
}

function constraintRefs(value: unknown, field: string): ConstraintRef[] {
  return readList(value, field).map((item) => {
    const json = readRecord(item, field);
    const point = json.point === undefined || json.point === null ? null : readOneOf(json.point, field, ['start', 'end'] as const);
    return { handle: readString(json.handle, field), point };
  });
}

const layerFlag = (json: Json, key: 'on' | 'frozen' | 'locked', field: string): boolean | undefined => optional(json, key, `${field}.${key}`, readBoolean);

function layerSet(value: unknown, field: string): Extract<Op, { type: 'layer_set' }>['set'] {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  return {
    ...(json.on === undefined ? {} : { on: layerFlag(json, 'on', field) }),
    ...(json.frozen === undefined ? {} : { frozen: layerFlag(json, 'frozen', field) }),
    ...(json.locked === undefined ? {} : { locked: layerFlag(json, 'locked', field) }),
    ...(json.colour === undefined ? {} : { colour: readOneOf(json.colour, at('colour'), COLOURS) }),
    ...(json.linetype === undefined ? {} : { linetype: readOneOf(json.linetype, at('linetype'), LINETYPES) }),
    ...(json.lineweight === undefined ? {} : { lineweight: readOneOf(json.lineweight, at('lineweight'), LINEWEIGHTS) }),
    ...(json.rename === undefined ? {} : { rename: readString(json.rename, at('rename')) }),
  };
}

function readOp(value: unknown, field: string): Op {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  const str = (key: string): string => readString(json[key], at(key));
  const num = (key: string): number => readNumber(json[key], at(key));
  const op_id = str('op_id');
  switch (readString(json.type, at('type'))) {
    case 'add': return { op_id, type: 'add', entity: readDraft(json.entity, at('entity')) };
    case 'modify': return { op_id, type: 'modify', handle: str('handle'), set: readRecord(json.set, at('set')) };
    case 'move': return { op_id, type: 'move', handles: strings(json.handles, at('handles')), dx: num('dx'), dy: num('dy') };
    case 'delete': return { op_id, type: 'delete', handles: strings(json.handles, at('handles')) };
    case 'layer_add':
      return {
        op_id, type: 'layer_add', name: str('name'), colour: readOneOf(json.colour, at('colour'), COLOURS),
        linetype: readOneOf(json.linetype, at('linetype'), LINETYPES), lineweight: readOneOf(json.lineweight, at('lineweight'), LINEWEIGHTS),
      };
    case 'layer_set': return { op_id, type: 'layer_set', name: str('name'), set: layerSet(json.set, at('set')) };
    case 'layer_delete': return { op_id, type: 'layer_delete', name: str('name') };
    case 'layer_state_save': return { op_id, type: 'layer_state_save', name: str('name') };
    case 'layer_state_restore': return { op_id, type: 'layer_state_restore', name: str('name') };
    case 'block_define':
      return {
        op_id, type: 'block_define', name: str('name'), base: readPoint(json.base, at('base')), handles: strings(json.handles, at('handles')),
        attributes: attributes(json.attributes ?? [], at('attributes')),
      };
    case 'explode': return { op_id, type: 'explode', handle: str('handle') };
    case 'purge': return { op_id, type: 'purge' };
    case 'dim_style_set':
      return {
        op_id, type: 'dim_style_set', name: str('name'), precision: num('precision'), prefix: str('prefix'), suffix: str('suffix'),
        scale: num('scale'), text_height_mm: num('text_height_mm'),
      };
    case 'constraint_add':
      return {
        op_id, type: 'constraint_add', kind: readOneOf(json.kind, at('kind'), CONSTRAINT_KINDS), refs: constraintRefs(json.refs, at('refs')),
        ...(json.expression === undefined || json.expression === null ? {} : { expression: str('expression') }),
      };
    case 'constraint_delete': return { op_id, type: 'constraint_delete', id: str('id') };
    case 'parameter_set': return { op_id, type: 'parameter_set', name: str('name'), expression: str('expression') };
    case 'parameter_delete': return { op_id, type: 'parameter_delete', name: str('name') };
    case 'xref_attach':
      return { op_id, type: 'xref_attach', name: str('name'), source: str('source'), x: num('x'), y: num('y'), scale: num('scale'), rotation: num('rotation') };
    case 'xref_clip': return { op_id, type: 'xref_clip', name: str('name'), rect: json.rect === null ? null : rect(json.rect, at('rect')) };
    case 'xref_reload': return { op_id, type: 'xref_reload', name: str('name') };
    case 'xref_bind': return { op_id, type: 'xref_bind', name: str('name') };
    case 'version_restore': return { op_id, type: 'version_restore', version: str('version') };
    case 'import_merge': return { op_id, type: 'import_merge', import_id: str('import_id') };
    default: throw fieldError(at('type'));
  }
}

/** Revisions are stored as 32-bit integers. */
const MAX_REVISION = 2 ** 31 - 1;

/**
 * The body of `POST /api/drawings/<id>/ops`: `base_revision` a whole number from 0, text `group_id` and `command`, a non-empty list of
 * ops with an `op_id` of its own each.
 */
export function parseOperationGroup(body: unknown): OperationGroup {
  const json = readRecord(body, 'body');
  const base_revision = readNumber(json.base_revision, 'base_revision');
  if (!Number.isInteger(base_revision) || base_revision < 0 || base_revision > MAX_REVISION) throw fieldError('base_revision');
  const group_id = readString(json.group_id, 'group_id');
  const command = readString(json.command, 'command');
  if (group_id === '') throw fieldError('group_id');
  if (command === '') throw fieldError('command');
  const ops = readList(json.ops, 'ops');
  if (ops.length === 0) throw fieldError('ops');
  const seen = new Set<string>();
  const parsed = ops.map((op, i) => {
    const read = readOp(op, `ops[${i}]`);
    if (seen.has(read.op_id)) throw fieldError(`ops[${i}].op_id`);
    seen.add(read.op_id);
    return read;
  });
  return { base_revision, group_id, command, ops: parsed };
}

// ---------------------------------------------------------------- the grading seed

export interface SeedXref { name: string; source: string; x: number; y: number; scale: number; rotation: number; clip: Rect | null }
/** A drawing record of the grading seed before the server has resolved its xref sources. */
export type SeedRecord = Omit<DrawingSeed, 'xrefs'> & { xrefs: SeedXref[] };

function seedEntity(value: unknown, field: string): SeedEntity {
  return { ...readDraft(value, field), handle: readString(readRecord(value, field).handle, `${field}.handle`) };
}

function seedLayer(value: unknown, field: string): Layer {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  return {
    name: readString(json.name, at('name')), colour: readOneOf(json.colour, at('colour'), COLOURS),
    linetype: readOneOf(json.linetype, at('linetype'), LINETYPES), lineweight: readOneOf(json.lineweight, at('lineweight'), LINEWEIGHTS),
    on: readBoolean(json.on, at('on')), frozen: readBoolean(json.frozen, at('frozen')), locked: readBoolean(json.locked, at('locked')),
  };
}

function seedBlock(value: unknown, field: string): SeedBlock {
  const json = readRecord(value, field);
  return {
    name: readString(json.name, `${field}.name`), base: readPoint(json.base, `${field}.base`),
    entities: readList(json.entities ?? [], `${field}.entities`).map((e, i) => seedEntity(e, `${field}.entities[${i}]`)),
    attributes: attributes(json.attributes ?? [], `${field}.attributes`),
  };
}

function seedStyle(value: unknown, field: string): DimStyle {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  return {
    name: readString(json.name, at('name')), precision: readNumber(json.precision, at('precision')), prefix: readString(json.prefix, at('prefix')),
    suffix: readString(json.suffix, at('suffix')), scale: readNumber(json.scale, at('scale')), text_height_mm: readNumber(json.text_height_mm, at('text_height_mm')),
  };
}

function seedConstraint(value: unknown, field: string): Pick<Constraint, 'kind' | 'refs' | 'expression'> {
  const json = readRecord(value, field);
  return {
    kind: readOneOf(json.kind, `${field}.kind`, CONSTRAINT_KINDS), refs: constraintRefs(json.refs, `${field}.refs`),
    ...(json.expression === undefined || json.expression === null ? {} : { expression: readString(json.expression, `${field}.expression`) }),
  };
}

function seedXref(value: unknown, field: string): SeedXref {
  const json = readRecord(value, field);
  const at = (key: string): string => `${field}.${key}`;
  return {
    name: readString(json.name, at('name')), source: readString(json.source, at('source')), x: readNumber(json.x, at('x')), y: readNumber(json.y, at('y')),
    scale: readNumber(json.scale, at('scale')), rotation: readNumber(json.rotation, at('rotation')),
    clip: json.clip === undefined || json.clip === null ? null : rect(json.clip, at('clip')),
  };
}

const parameter = (value: unknown, field: string): Parameter => {
  const json = readRecord(value, field);
  return { name: readString(json.name, `${field}.name`), expression: readString(json.expression, `${field}.expression`) };
};

/** The most lines a seed may generate; the largest drawing the brief names has 10 000 entities. */
const MAX_GENERATED_LINES = 200000;

/** The engine-facing fields of one `drawings[]` record of the grading seed (everything except `key`, `folder`, `name` and `sheets`). */
export function parseDrawingSeed(record: unknown): SeedRecord {
  const json = readRecord(record, 'drawing');
  const items = <T>(key: string, read: (value: unknown, field: string) => T): T[] | undefined =>
    optional(json, key, key, (value, field) => readList(value, field).map((item, i) => read(item, `${field}[${i}]`)));
  const generate = optional(json, 'generate', 'generate', (value, field) => {
    const g = readRecord(value, field);
    const lines = readNumber(g.lines, `${field}.lines`);
    if (!Number.isInteger(lines) || lines < 0 || lines > MAX_GENERATED_LINES) throw fieldError(`${field}.lines`);
    return { lines, spacing: readNumber(g.spacing, `${field}.spacing`) };
  });
  return {
    layers: items('layers', seedLayer), entities: items('entities', seedEntity), generate, blocks: items('blocks', seedBlock),
    dim_styles: items('dim_styles', seedStyle), parameters: items('parameters', parameter), constraints: items('constraints', seedConstraint),
    xrefs: items('xrefs', seedXref) ?? [], layer_states: items('layer_states', (value, field) => ({ name: readString(readRecord(value, field).name, field) })),
  };
}

