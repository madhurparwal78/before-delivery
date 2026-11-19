import {
  LIMITS,
  PORTS,
  SHAPE_KINDS,
  type Port,
  type ShapeKind,
} from './document.js';
import {
  type FieldErrors,
  type Validated,
  invalid,
  isPlainObject,
  isWholeNumber,
  joinPath,
  unpublishedKey,
  validateLabel,
  validateObjectName,
  wholeNumberInRange,
} from './validate.js';

/** The fields a `set` may name. */
export interface ShapeSet {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string;
  layer?: string;
}

export const SET_KEYS: readonly string[] = ['x', 'y', 'w', 'h', 'label', 'layer'];

export interface ShapeEntry {
  shape: string;
  set: ShapeSet;
}

export interface AddShapeOp {
  kind: 'add_shape';
  page: string;
  layer: string;
  shape: { kind: ShapeKind; x: number; y: number; w: number; h: number; label: string };
  clientRef: string;
}

export interface UpdateShapeOp {
  kind: 'update_shape';
  shape: string;
  set: ShapeSet;
}

export interface UpdateShapesOp {
  kind: 'update_shapes';
  shapes: ShapeEntry[];
}

export interface DeleteShapeOp {
  kind: 'delete_shape';
  shape: string;
}

export interface AddConnectorOp {
  kind: 'add_connector';
  page: string;
  from: { shape: string; port: Port };
  to: { shape: string; port: Port };
  label: string;
  clientRef: string;
}

export interface DeleteConnectorOp {
  kind: 'delete_connector';
  connector: string;
}

/** Operations that travel over the live socket only. */
export interface DeleteShapesOp {
  kind: 'delete_shapes';
  shapes: string[];
}

export interface DuplicateShapesOp {
  kind: 'duplicate_shapes';
  shapes: string[];
  dx: number;
  dy: number;
}

export interface ReorderShapeOp {
  kind: 'reorder_shape';
  shapes: string[];
  direction: 'forward' | 'backward';
}

export interface GroupShapesOp {
  kind: 'group_shapes';
  shapes: string[];
}

export interface UngroupShapesOp {
  kind: 'ungroup_shapes';
  groups: string[];
}

export interface AddPageOp {
  kind: 'add_page';
  name: string;
}

export interface RenamePageOp {
  kind: 'rename_page';
  page: string;
  name: string;
}

export interface ReorderPageOp {
  kind: 'reorder_page';
  page: string;
  direction: 'up' | 'down';
}

export interface DeletePageOp {
  kind: 'delete_page';
  page: string;
}

export interface AddLayerOp {
  kind: 'add_layer';
  page: string;
  name: string;
}

export interface RenameLayerOp {
  kind: 'rename_layer';
  layer: string;
  name: string;
}

export interface ReorderLayerOp {
  kind: 'reorder_layer';
  layer: string;
  direction: 'up' | 'down';
}

export interface SetLayerFlagOp {
  kind: 'set_layer_flag';
  layer: string;
  flag: 'visible' | 'locked';
  value: boolean;
}

export interface RestoreVersionOp {
  kind: 'restore_version';
  version: string;
}

export interface UndoOp {
  kind: 'undo';
}

export interface RedoOp {
  kind: 'redo';
}

export type Operation =
  | AddShapeOp
  | UpdateShapeOp
  | UpdateShapesOp
  | DeleteShapeOp
  | AddConnectorOp
  | DeleteConnectorOp
  | DeleteShapesOp
  | DuplicateShapesOp
  | ReorderShapeOp
  | GroupShapesOp
  | UngroupShapesOp
  | AddPageOp
  | RenamePageOp
  | ReorderPageOp
  | DeletePageOp
  | AddLayerOp
  | RenameLayerOp
  | ReorderLayerOp
  | SetLayerFlagOp
  | RestoreVersionOp
  | UndoOp
  | RedoOp;

export interface OperationRequest {
  opId: string;
  baseSeq: number;
  op: Operation;
}

/** The operation kinds the HTTP operations endpoint accepts. */
export const HTTP_OPERATION_KINDS: readonly string[] = [
  'add_shape',
  'update_shape',
  'update_shapes',
  'delete_shape',
  'add_connector',
  'delete_connector',
];

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;

const KEYS: Record<string, readonly string[]> = {
  add_shape: ['kind', 'page', 'layer', 'shape', 'clientRef'],
  update_shape: ['kind', 'shape', 'set'],
  update_shapes: ['kind', 'shapes'],
  delete_shape: ['kind', 'shape'],
  add_connector: ['kind', 'page', 'from', 'to', 'label', 'clientRef'],
  delete_connector: ['kind', 'connector'],
  delete_shapes: ['kind', 'shapes'],
  duplicate_shapes: ['kind', 'shapes', 'dx', 'dy'],
  reorder_shape: ['kind', 'shapes', 'direction'],
  group_shapes: ['kind', 'shapes'],
  ungroup_shapes: ['kind', 'groups'],
  add_page: ['kind', 'name'],
  rename_page: ['kind', 'page', 'name'],
  reorder_page: ['kind', 'page', 'direction'],
  delete_page: ['kind', 'page'],
  add_layer: ['kind', 'page', 'name'],
  rename_layer: ['kind', 'layer', 'name'],
  reorder_layer: ['kind', 'layer', 'direction'],
  set_layer_flag: ['kind', 'layer', 'flag', 'value'],
  restore_version: ['kind', 'version'],
  undo: ['kind'],
  redo: ['kind'],
};

const ADD_SHAPE_KEYS: readonly string[] = ['kind', 'x', 'y', 'w', 'h', 'label'];
const END_KEYS: readonly string[] = ['shape', 'port'];
const ENTRY_KEYS: readonly string[] = ['shape', 'set'];

function idString(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return invalid(path, 'Name an object of this diagram.');
  }
  return { ok: true, value };
}

function parseSet(raw: unknown, path: string): Validated<ShapeSet> {
  if (!isPlainObject(raw)) return invalid(path, 'Provide the fields to change.');
  const extra = unpublishedKey(raw, SET_KEYS, path);
  if (extra) return invalid(extra, 'This field cannot be set.');
  if (Object.keys(raw).length === 0) return invalid(path, 'Name at least one field to change.');
  const set: ShapeSet = {};
  for (const axis of ['x', 'y'] as const) {
    if (axis in raw) {
      if (!wholeNumberInRange(raw[axis], LIMITS.coordMin, LIMITS.coordMax)) {
        return invalid(joinPath(path, axis), `Enter a whole number from ${LIMITS.coordMin} to ${LIMITS.coordMax}.`);
      }
      set[axis] = raw[axis];
    }
  }
  for (const size of ['w', 'h'] as const) {
    if (size in raw) {
      if (!wholeNumberInRange(raw[size], LIMITS.sizeMin, LIMITS.sizeMax)) {
        return invalid(joinPath(path, size), `Enter a whole number from ${LIMITS.sizeMin} to ${LIMITS.sizeMax}.`);
      }
      set[size] = raw[size];
    }
  }
  if ('label' in raw) {
    const label = validateLabel(raw['label'], joinPath(path, 'label'));
    if (!label.ok) return label;
    set.label = label.value;
  }
  if ('layer' in raw) {
    const layer = idString(raw['layer'], joinPath(path, 'layer'));
    if (!layer.ok) return layer;
    set.layer = layer.value;
  }
  return { ok: true, value: set };
}

function parsePort(value: unknown, path: string): Validated<Port> {
  if (typeof value !== 'string' || !PORTS.includes(value as Port)) {
    return invalid(path, 'Choose the port n, e, s or w.');
  }
  return { ok: true, value: value as Port };
}

function parseEnd(raw: unknown, path: string): Validated<{ shape: string; port: Port }> {
  if (!isPlainObject(raw)) return invalid(path, 'Name a shape and a port.');
  const extra = unpublishedKey(raw, END_KEYS, path);
  if (extra) return invalid(extra, 'This field cannot be set.');
  const shape = idString(raw['shape'], joinPath(path, 'shape'));
  if (!shape.ok) return shape;
  const port = parsePort(raw['port'], joinPath(path, 'port'));
  if (!port.ok) return port;
  return { ok: true, value: { shape: shape.value, port: port.value } };
}

function parseIdList(raw: unknown, path: string, max: number): Validated<string[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > max) {
    return invalid(path, `Name 1 to ${max} objects.`);
  }
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const id = idString(raw[i], joinPath(path, i));
    if (!id.ok) return id;
    ids.push(id.value);
  }
  return { ok: true, value: ids };
}

/**
 * Parses an operation body under the published keys rule. Any key that is not published
 * fails with its dotted path from the root of the request body.
 */
export function parseOperationRequest(
  body: unknown,
  allowedKinds: readonly string[],
): Validated<OperationRequest> {
  if (!isPlainObject(body)) return invalid('', 'Send an operation.');
  const extra = unpublishedKey(body, ['opId', 'baseSeq', 'op'], '');
  if (extra) return invalid(extra, 'This field cannot be set.');
  if (typeof body['opId'] !== 'string' || !OP_ID.test(body['opId'])) {
    return invalid('opId', 'Use 1 to 64 letters, digits, underscores or hyphens.');
  }
  if (!isWholeNumber(body['baseSeq']) || body['baseSeq'] < 0) {
    return invalid('baseSeq', 'Send the last seq you have seen.');
  }
  const op = parseOperation(body['op'], 'op', allowedKinds);
  if (!op.ok) return op;
  return { ok: true, value: { opId: body['opId'], baseSeq: body['baseSeq'], op: op.value } };
}

export function parseOperation(
  raw: unknown,
  path: string,
  allowedKinds: readonly string[],
): Validated<Operation> {
  if (!isPlainObject(raw)) return invalid(path, 'Send an operation.');
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !allowedKinds.includes(kind)) {
    return invalid(joinPath(path, 'kind'), 'Choose a published operation kind.');
  }
  const allowed = KEYS[kind];
  if (!allowed) return invalid(joinPath(path, 'kind'), 'Choose a published operation kind.');
  const extra = unpublishedKey(raw, allowed, path);
  if (extra) return invalid(extra, 'This field cannot be set.');
  switch (kind) {
    case 'add_shape':
      return parseAddShape(raw, path);
    case 'update_shape':
      return parseUpdateShape(raw, path);
    case 'update_shapes':
      return parseUpdateShapes(raw, path);
    case 'delete_shape':
      return withId(raw, path, 'shape', (shape) => ({ kind: 'delete_shape', shape }));
    case 'add_connector':
      return parseAddConnector(raw, path);
    case 'delete_connector':
      return withId(raw, path, 'connector', (connector) => ({ kind: 'delete_connector', connector }));
    case 'delete_shapes': {
      const shapes = parseIdList(raw['shapes'], joinPath(path, 'shapes'), LIMITS.shapesPerPage);
      return shapes.ok ? { ok: true, value: { kind: 'delete_shapes', shapes: shapes.value } } : shapes;
    }
    case 'duplicate_shapes':
      return parseDuplicateShapes(raw, path);
    case 'reorder_shape': {
      const shapes = parseIdList(raw['shapes'], joinPath(path, 'shapes'), LIMITS.shapesPerPage);
      if (!shapes.ok) return shapes;
      const direction = raw['direction'];
      if (direction !== 'forward' && direction !== 'backward') {
        return invalid(joinPath(path, 'direction'), 'Choose forward or backward.');
      }
      return { ok: true, value: { kind: 'reorder_shape', shapes: shapes.value, direction } };
    }
    case 'group_shapes': {
      const shapes = parseIdList(raw['shapes'], joinPath(path, 'shapes'), LIMITS.shapesPerPage);
      return shapes.ok ? { ok: true, value: { kind: 'group_shapes', shapes: shapes.value } } : shapes;
    }
    case 'ungroup_shapes': {
      const groups = parseIdList(raw['groups'], joinPath(path, 'groups'), LIMITS.shapesPerPage);
      return groups.ok ? { ok: true, value: { kind: 'ungroup_shapes', groups: groups.value } } : groups;
    }
    case 'add_page': {
      const name = validateObjectName(raw['name'], joinPath(path, 'name'));
      return name.ok ? { ok: true, value: { kind: 'add_page', name: name.value } } : name;
    }
    case 'rename_page':
      return parseNamed(raw, path, 'page', (page, name) => ({ kind: 'rename_page', page, name }));
    case 'reorder_page':
      return parseReorder(raw, path, 'page', (page, direction) => ({ kind: 'reorder_page', page, direction }));
    case 'delete_page':
      return withId(raw, path, 'page', (page) => ({ kind: 'delete_page', page }));
    case 'add_layer': {
      const page = idString(raw['page'], joinPath(path, 'page'));
      if (!page.ok) return page;
      const name = validateObjectName(raw['name'], joinPath(path, 'name'));
      return name.ok ? { ok: true, value: { kind: 'add_layer', page: page.value, name: name.value } } : name;
    }
    case 'rename_layer':
      return parseNamed(raw, path, 'layer', (layer, name) => ({ kind: 'rename_layer', layer, name }));
    case 'reorder_layer':
      return parseReorder(raw, path, 'layer', (layer, direction) => ({ kind: 'reorder_layer', layer, direction }));
    case 'set_layer_flag': {
      const layer = idString(raw['layer'], joinPath(path, 'layer'));
      if (!layer.ok) return layer;
      const flag = raw['flag'];
      if (flag !== 'visible' && flag !== 'locked') {
        return invalid(joinPath(path, 'flag'), 'Choose visible or locked.');
      }
      if (typeof raw['value'] !== 'boolean') {
        return invalid(joinPath(path, 'value'), 'Choose true or false.');
      }
      return { ok: true, value: { kind: 'set_layer_flag', layer: layer.value, flag, value: raw['value'] } };
    }
    case 'restore_version':
      return withId(raw, path, 'version', (version) => ({ kind: 'restore_version', version }));
    case 'undo':
      return { ok: true, value: { kind: 'undo' } };
    case 'redo':
      return { ok: true, value: { kind: 'redo' } };
    default:
      return invalid(joinPath(path, 'kind'), 'Choose a published operation kind.');
  }
}

function withId(
  raw: Record<string, unknown>,
  path: string,
  key: string,
  make: (id: string) => Operation,
): Validated<Operation> {
  const id = idString(raw[key], joinPath(path, key));
  return id.ok ? { ok: true, value: make(id.value) } : id;
}

function parseNamed(
  raw: Record<string, unknown>,
  path: string,
  key: string,
  make: (id: string, name: string) => Operation,
): Validated<Operation> {
  const id = idString(raw[key], joinPath(path, key));
  if (!id.ok) return id;
  const name = validateObjectName(raw['name'], joinPath(path, 'name'));
  return name.ok ? { ok: true, value: make(id.value, name.value) } : name;
}

function parseReorder(
  raw: Record<string, unknown>,
  path: string,
  key: string,
  make: (id: string, direction: 'up' | 'down') => Operation,
): Validated<Operation> {
  const id = idString(raw[key], joinPath(path, key));
  if (!id.ok) return id;
  const direction = raw['direction'];
  if (direction !== 'up' && direction !== 'down') {
    return invalid(joinPath(path, 'direction'), 'Choose up or down.');
  }
  return { ok: true, value: make(id.value, direction) };
}

function parseAddShape(raw: Record<string, unknown>, path: string): Validated<Operation> {
  const page = idString(raw['page'], joinPath(path, 'page'));
  if (!page.ok) return page;
  const layer = idString(raw['layer'], joinPath(path, 'layer'));
  if (!layer.ok) return layer;
  const clientRef = clientRefOf(raw['clientRef'], joinPath(path, 'clientRef'));
  if (!clientRef.ok) return clientRef;
  const shapePath = joinPath(path, 'shape');
  const shape = raw['shape'];
  if (!isPlainObject(shape)) return invalid(shapePath, 'Describe the shape.');
  const extra = unpublishedKey(shape, ADD_SHAPE_KEYS, shapePath);
  if (extra) return invalid(extra, 'This field cannot be set.');
  const kind = shape['kind'];
  if (typeof kind !== 'string' || !SHAPE_KINDS.includes(kind as ShapeKind)) {
    return invalid(joinPath(shapePath, 'kind'), 'Choose rectangle, ellipse, diamond or text.');
  }
  const geometry: Record<'x' | 'y' | 'w' | 'h', number> = { x: 0, y: 0, w: 0, h: 0 };
  for (const axis of ['x', 'y'] as const) {
    if (!wholeNumberInRange(shape[axis], LIMITS.coordMin, LIMITS.coordMax)) {
      return invalid(
        joinPath(shapePath, axis),
        `Enter a whole number from ${LIMITS.coordMin} to ${LIMITS.coordMax}.`,
      );
    }
    geometry[axis] = shape[axis];
  }
  for (const size of ['w', 'h'] as const) {
    if (!wholeNumberInRange(shape[size], LIMITS.sizeMin, LIMITS.sizeMax)) {
      return invalid(
        joinPath(shapePath, size),
        `Enter a whole number from ${LIMITS.sizeMin} to ${LIMITS.sizeMax}.`,
      );
    }
    geometry[size] = shape[size];
  }
  const label = validateLabel(shape['label'] ?? '', joinPath(shapePath, 'label'));
  if (!label.ok) return label;
  return {
    ok: true,
    value: {
      kind: 'add_shape',
      page: page.value,
      layer: layer.value,
      shape: { kind: kind as ShapeKind, ...geometry, label: label.value },
      clientRef: clientRef.value,
    },
  };
}

function parseUpdateShape(raw: Record<string, unknown>, path: string): Validated<Operation> {
  const shape = idString(raw['shape'], joinPath(path, 'shape'));
  if (!shape.ok) return shape;
  const set = parseSet(raw['set'], joinPath(path, 'set'));
  if (!set.ok) return set;
  return { ok: true, value: { kind: 'update_shape', shape: shape.value, set: set.value } };
}

function parseUpdateShapes(raw: Record<string, unknown>, path: string): Validated<Operation> {
  const listPath = joinPath(path, 'shapes');
  const list = raw['shapes'];
  if (!Array.isArray(list) || list.length < 1 || list.length > LIMITS.shapesPerPage) {
    return invalid(listPath, `Name 1 to ${LIMITS.shapesPerPage} shapes.`);
  }
  const entries: ShapeEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const entryPath = joinPath(listPath, i);
    const entry = list[i];
    if (!isPlainObject(entry)) return invalid(entryPath, 'Name a shape and the fields to change.');
    const extra = unpublishedKey(entry, ENTRY_KEYS, entryPath);
    if (extra) return invalid(extra, 'This field cannot be set.');
    const shape = idString(entry['shape'], joinPath(entryPath, 'shape'));
    if (!shape.ok) return shape;
    if (seen.has(shape.value)) {
      return invalid(joinPath(entryPath, 'shape'), 'Name each shape only once.');
    }
    seen.add(shape.value);
    const set = parseSet(entry['set'], joinPath(entryPath, 'set'));
    if (!set.ok) return set;
    entries.push({ shape: shape.value, set: set.value });
  }
  return { ok: true, value: { kind: 'update_shapes', shapes: entries } };
}

function parseAddConnector(raw: Record<string, unknown>, path: string): Validated<Operation> {
  const page = idString(raw['page'], joinPath(path, 'page'));
  if (!page.ok) return page;
  const from = parseEnd(raw['from'], joinPath(path, 'from'));
  if (!from.ok) return from;
  const to = parseEnd(raw['to'], joinPath(path, 'to'));
  if (!to.ok) return to;
  const label = validateLabel(raw['label'] ?? '', joinPath(path, 'label'));
  if (!label.ok) return label;
  const clientRef = clientRefOf(raw['clientRef'], joinPath(path, 'clientRef'));
  if (!clientRef.ok) return clientRef;
  return {
    ok: true,
    value: {
      kind: 'add_connector',
      page: page.value,
      from: from.value,
      to: to.value,
      label: label.value,
      clientRef: clientRef.value,
    },
  };
}

function parseDuplicateShapes(raw: Record<string, unknown>, path: string): Validated<Operation> {
  const shapes = parseIdList(raw['shapes'], joinPath(path, 'shapes'), LIMITS.shapesPerPage);
  if (!shapes.ok) return shapes;
  for (const axis of ['dx', 'dy'] as const) {
    if (!wholeNumberInRange(raw[axis], LIMITS.coordMin, LIMITS.coordMax)) {
      return invalid(joinPath(path, axis), 'Enter a whole number.');
    }
  }
  return {
    ok: true,
    value: {
      kind: 'duplicate_shapes',
      shapes: shapes.value,
      dx: raw['dx'] as number,
      dy: raw['dy'] as number,
    },
  };
}

function clientRefOf(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return invalid(path, 'Send a client reference of 1 to 64 characters.');
  }
  return { ok: true, value };
}

export type { FieldErrors };
