import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ActivityEntry, DrawingObject, PlotStyle, Point } from '../shared/api';
import { OBJECT_COLORS, OBJECT_LINETYPES, OBJECT_LINEWEIGHTS, PLOT_STYLES, STYLE_NAMES, VIEWPORT_SCALES } from '../shared/api';
import { copy } from '../shared/copy';
import { formatClockTime, objectCount, type Units } from '../shared/format';
import { argsOf, readBoolean, readHandle, readHandles, readInteger, readNumber, readPoint, readPositive, readText } from './args';
import { ApiError, fail, invalid } from './errors';
import { cross, polar, wrap360 } from './geometry';
import { isBlockName } from './blocks';
import {
  checkLayerColor,
  checkLayerDeletable,
  checkLayerFreezable,
  checkLayerLinetype,
  checkLayerLineweight,
  checkLayerName,
  checkLayerRenamable,
  nextLayerName,
  NEW_LAYER_DEFAULTS,
} from './layers';
import { extendObject, filletLines, offsetGeometry, trimObject } from './modify';
import {
  asArc,
  asCircle,
  asDimension,
  asInsert,
  asMText,
  DEFAULT_TEXT_HEIGHT,
  mirroredGeometry,
  movedGeometry,
  rotatedGeometry,
  scaledGeometry,
  serializeObject,
  type ObjectGeometry,
  type StoredObject,
} from './model';
import { compareHandles, EditSession, persistSession, type VersionSnapshot } from './session';
import { findDrawingRecord, loadDrawingState, lockDrawingRecord, type DrawingRecord } from './drawings';
import { queryOn, transaction } from './db';

export interface CommandActor {
  name: string;
  key: string;
}

export interface CommandOutcome {
  version: number;
  created: string[];
  modified: string[];
  erased: string[];
  locked: string[];
  objects: DrawingObject[];
  history: string | null;
  changed: string[];
  activity: ActivityEntry | null;
}

const NO_UNDO_COMMANDS = new Set(['UNDO', 'REDO']);

interface Context {
  session: EditSession;
  args: Record<string, unknown>;
  actor: CommandActor;
  client: PoolClient;
  record: DrawingRecord;
}

function signedArea(vertices: Point[]): number {
  let twice = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    twice += cross(vertices[i]!, vertices[(i + 1) % vertices.length]!);
  }
  return twice / 2;
}

/** RECTANG: four vertices starting at `first` and going counter-clockwise. */
function rectangleVertices(first: Point, other: Point): Point[] {
  const clockwiseFirst: Point[] = [first, [other[0], first[1]], other, [first[0], other[1]]];
  if (signedArea(clockwiseFirst) >= 0) return clockwiseFirst;
  return [first, [first[0], other[1]], other, [other[0], first[1]]];
}

function visibleEdges(session: EditSession): StoredObject[] {
  return [...session.objects.values()].filter((object) => {
    const layer = session.layers.find((candidate) => candidate.name === object.layer);
    return layer !== undefined && layer.on && !layer.frozen;
  });
}

function singleEditable(session: EditSession, handle: string): StoredObject | null {
  const objects = session.editable([handle]);
  if (objects.length === 0) return null;
  return objects[0]!;
}

function requireObject(session: EditSession, handle: string): StoredObject {
  const object = session.objects.get(handle);
  if (object === undefined) invalid('handles', copy.history.noObjectFound);
  return object;
}

// ---------------------------------------------------------------------------
// Property setters
// ---------------------------------------------------------------------------

function enumeration(field: string, value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(field, 'Choose a value from the list.');
  return value as string;
}

function numeric(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field, copy.properties.notANumber);
  return value as number;
}

function point(field: string, value: unknown): Point {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    invalid(field, copy.properties.notANumber);
  }
  return [value[0] as number, value[1] as number];
}

function applyGeometryField(object: StoredObject, field: string, value: unknown): ObjectGeometry | null {
  switch (object.type) {
    case 'line': {
      if (field === 'start' || field === 'end') {
        return { ...(object.data as { start: Point; end: Point }), [field]: point(field, value) } as ObjectGeometry;
      }
      return null;
    }
    case 'circle': {
      const circle = asCircle(object);
      if (field === 'center') return { ...circle, center: point(field, value) };
      if (field === 'radius') {
        const radius = numeric(field, value);
        if (radius <= 0) invalid(field, copy.history.positiveNumber);
        return { ...circle, radius };
      }
      return null;
    }
    case 'arc': {
      const arc = asArc(object);
      if (field === 'center') return { ...arc, center: point(field, value) };
      if (field === 'radius') {
        const radius = numeric(field, value);
        if (radius <= 0) invalid(field, copy.history.positiveNumber);
        return { ...arc, radius };
      }
      return null;
    }
    case 'insert': {
      const insert = asInsert(object);
      if (field === 'position') return { ...insert, position: point(field, value) };
      if (field === 'scale') {
        const scale = numeric(field, value);
        if (scale <= 0) invalid(field, copy.history.positiveNumber);
        return { ...insert, scale };
      }
      if (field === 'rotation') return { ...insert, rotation: wrap360(numeric(field, value)) };
      return null;
    }
    case 'mtext': {
      const text = asMText(object);
      if (field === 'contents') return { ...text, contents: readText({ contents: value }, 'contents', 4000) };
      if (field === 'height') {
        const height = numeric(field, value);
        if (height <= 0) invalid(field, copy.history.positiveNumber);
        return { ...text, height };
      }
      if (field === 'width') {
        const width = numeric(field, value);
        if (width <= 0) invalid(field, copy.history.positiveNumber);
        return { ...text, width };
      }
      return null;
    }
    case 'dimension': {
      const dimension = asDimension(object);
      if (field === 'text_override') {
        if (value === null || value === '') return { ...dimension, text_override: null };
        return { ...dimension, text_override: readText({ text_override: value }, 'text_override', 120) };
      }
      return null;
    }
    default:
      return null;
  }
}

function applyProperties(context: Context): void {
  const { session, args } = context;
  const model = args.model;
  if (model !== undefined) {
    const fields = argsOf(model);
    if (fields.units !== undefined) {
      session.units = enumeration('units', fields.units, ['mm', 'm']) as Units;
    }
    if (fields.plot_style !== undefined) {
      session.plotStyle = enumeration('plot_style', fields.plot_style, PLOT_STYLES) as PlotStyle;
    }
    session.touchModel();
    return;
  }
  const handles = readHandles(args, 'handles');
  const set = argsOf(args.set);
  const targets = session.editable(handles);
  for (const object of targets) {
    for (const [field, value] of Object.entries(set)) {
      switch (field) {
        case 'layer': {
          const name = enumeration('layer', value, session.layers.map((layer) => layer.name));
          session.patchObject(object.handle, { layer: name });
          break;
        }
        case 'color':
          session.patchObject(object.handle, { color: enumeration('color', value, OBJECT_COLORS) });
          break;
        case 'linetype':
          session.patchObject(object.handle, { linetype: enumeration('linetype', value, OBJECT_LINETYPES) });
          break;
        case 'lineweight':
          session.patchObject(object.handle, { lineweight: enumeration('lineweight', value, OBJECT_LINEWEIGHTS) });
          break;
        case 'linetype_scale': {
          const scale = numeric('linetype_scale', value);
          if (scale < 0.01 || scale > 1000) invalid('linetype_scale', copy.properties.linetypeScaleRange);
          session.patchObject(object.handle, { linetype_scale: Math.round(scale * 100) / 100 });
          break;
        }
        case 'dimension_style':
          session.patchObject(object.handle, {
            dimension_style: enumeration('dimension_style', value, STYLE_NAMES),
          });
          break;
        case 'text_style':
          session.patchObject(object.handle, { text_style: enumeration('text_style', value, STYLE_NAMES) });
          break;
        case 'multileader_style':
          session.patchObject(object.handle, {
            multileader_style: enumeration('multileader_style', value, STYLE_NAMES),
          });
          break;
        default: {
          const geometry = applyGeometryField(object, field, value);
          if (geometry === null) invalid(field, 'This field can\'t be edited.');
          session.replaceGeometry(object.handle, geometry);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layers, layouts and xrefs
// ---------------------------------------------------------------------------

function applyLayer(context: Context): void {
  const { session, args } = context;
  const op = enumeration('args', args.op, ['new', 'rename', 'set', 'current', 'delete']);
  if (op === 'new') {
    const name = nextLayerName(session.layers);
    session.layers.push({
      name,
      color: NEW_LAYER_DEFAULTS.color,
      linetype: NEW_LAYER_DEFAULTS.linetype,
      lineweight: NEW_LAYER_DEFAULTS.lineweight,
      on: true,
      frozen: false,
      locked: false,
      current: false,
      ord: session.layers.length,
    });
    session.touchLayers();
    return;
  }
  const name = readText(args, 'name', 64);
  const layer = session.layers.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (layer === undefined) fail('not_found');
  if (op === 'rename') {
    const newName = readText(args, 'new_name', 64);
    checkLayerRenamable(layer);
    checkLayerName(newName, session.layers, layer.name);
    const oldName = layer.name;
    layer.name = newName;
    for (const object of session.objects.values()) {
      if (object.layer === oldName) session.patchObject(object.handle, { layer: newName });
    }
    session.touchLayers();
    return;
  }
  if (op === 'current') {
    for (const candidate of session.layers) candidate.current = candidate.name === layer.name;
    session.touchLayers();
    return;
  }
  if (op === 'delete') {
    checkLayerDeletable(layer, [...session.objects.values()]);
    session.layers = session.layers.filter((candidate) => candidate.name !== layer.name);
    session.touchLayers();
    return;
  }
  if (args.frozen !== undefined) {
    const frozen = args.frozen === true;
    if (frozen) checkLayerFreezable(layer);
    layer.frozen = frozen;
  }
  if (args.on !== undefined) layer.on = args.on === true;
  if (args.locked !== undefined) layer.locked = args.locked === true;
  if (args.color !== undefined) {
    const color = enumeration('color', args.color, OBJECT_COLORS.slice(1));
    checkLayerColor(color);
    layer.color = color;
  }
  if (args.linetype !== undefined) {
    const linetype = enumeration('linetype', args.linetype, OBJECT_LINETYPES.slice(1));
    checkLayerLinetype(linetype);
    layer.linetype = linetype;
  }
  if (args.lineweight !== undefined) {
    const lineweight = enumeration('lineweight', args.lineweight, OBJECT_LINEWEIGHTS.slice(1));
    checkLayerLineweight(lineweight);
    layer.lineweight = lineweight;
  }
  session.touchLayers();
}

function applyLayout(context: Context): void {
  const { session, args } = context;
  const op = enumeration('args', args.op, ['new', 'scale']);
  if (op === 'new') {
    const numbers = session.layouts
      .map((layout) => /^Layout(\d+)$/.exec(layout.name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));
    const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
    session.layouts.push({ name: `Layout${next}`, viewport_scale: '1:50', ord: session.layouts.length });
    session.touchLayouts();
    return;
  }
  const name = readText(args, 'name', 80);
  const layout = session.layouts.find((candidate) => candidate.name === name);
  if (layout === undefined || layout.viewport_scale === null) fail('not_found');
  layout.viewport_scale = enumeration('viewport_scale', args.viewport_scale, VIEWPORT_SCALES) as (typeof VIEWPORT_SCALES)[number];
  session.touchLayouts();
}

async function applyXref(context: Context): Promise<void> {
  const { session, args, client, record } = context;
  const op = enumeration('args', args.op, ['attach', 'unload', 'reload', 'detach']);
  if (op === 'attach') {
    const drawingId = readText(args, 'drawing_id', 80);
    if (drawingId === record.id) invalid('drawing_id', 'Choose another drawing.');
    const source = await findDrawingRecord(drawingId, client);
    if (source === null || source.workspace_id !== record.workspace_id) fail('not_found');
    session.xrefs.push({
      id: crypto.randomUUID(),
      source_drawing_id: source.id,
      name: source.name,
      status: 'loaded',
    });
    session.touchXrefs();
    return;
  }
  const xrefId = readText(args, 'xref_id', 80);
  const xref = session.xrefs.find((candidate) => candidate.id === xrefId);
  if (xref === undefined) fail('not_found');
  if (op === 'detach') session.xrefs = session.xrefs.filter((candidate) => candidate.id !== xrefId);
  else xref.status = op === 'unload' ? 'unloaded' : 'loaded';
  session.touchXrefs();
}

// ---------------------------------------------------------------------------
// Geometry commands
// ---------------------------------------------------------------------------

function readPoints(args: Record<string, unknown>, field: string, minimum: number): Point[] {
  const value = args[field];
  if (!Array.isArray(value) || value.length < minimum) invalid('args', copy.history.invalidPoint);
  return (value as unknown[]).map((entry) => point('args', entry));
}

function applyDrawCommand(command: string, context: Context): void {
  const { session, args } = context;
  switch (command) {
    case 'LINE': {
      const points = readPoints(args, 'points', 2);
      const close = readBoolean(args, 'close');
      for (let i = 0; i < points.length - 1; i += 1) {
        session.createObject('line', { start: points[i]!, end: points[i + 1]! });
      }
      if (close && points.length > 2) {
        session.createObject('line', { start: points.at(-1)!, end: points[0]! });
      }
      return;
    }
    case 'PLINE': {
      const points = readPoints(args, 'points', 2);
      session.createObject('polyline', { vertices: points, closed: readBoolean(args, 'closed') });
      return;
    }
    case 'RECTANG': {
      const first = readPoint(args, 'first');
      const other = readPoint(args, 'other');
      session.createObject('polyline', { vertices: rectangleVertices(first, other), closed: true });
      return;
    }
    case 'CIRCLE': {
      session.createObject('circle', { center: readPoint(args, 'center'), radius: readPositive(args, 'radius') });
      return;
    }
    case 'ARC': {
      session.createObject('arc', {
        center: readPoint(args, 'center'),
        radius: readPositive(args, 'radius'),
        start_angle: wrap360(readNumber(args, 'start_angle')),
        end_angle: wrap360(readNumber(args, 'end_angle')),
      });
      return;
    }
    case 'POLYGON': {
      const center = readPoint(args, 'center');
      const sides = readInteger(args, 'sides', 3);
      const radius = readPositive(args, 'radius');
      const vertices: Point[] = [];
      for (let i = 0; i < sides; i += 1) vertices.push(polar(center, radius, (360 * i) / sides));
      session.createObject('polyline', { vertices, closed: true });
      return;
    }
    case 'SPLINE': {
      session.createObject('spline', { fit_points: readPoints(args, 'fit_points', 2) });
      return;
    }
    case 'MTEXT': {
      session.createObject('mtext', {
        position: readPoint(args, 'position'),
        width: readPositive(args, 'width'),
        height: args.height === undefined ? DEFAULT_TEXT_HEIGHT : readPositive(args, 'height'),
        contents: readText(args, 'contents', 4000),
      });
      return;
    }
    case 'INSERT': {
      const block = readText(args, 'block', 80);
      if (!isBlockName(block)) invalid('block', 'Choose a block from the library.');
      session.createObject('insert', {
        block,
        position: readPoint(args, 'position'),
        scale: readPositive(args, 'scale'),
        rotation: wrap360(readNumber(args, 'rotation')),
      });
      return;
    }
    default:
      invalid('command', 'Unknown command.');
  }
}

function applyTransformCommand(command: string, context: Context): void {
  const { session, args } = context;
  const handles = readHandles(args, 'handles');
  const targets = session.editable(handles);
  switch (command) {
    case 'MOVE':
    case 'COPY': {
      const from = readPoint(args, 'from');
      const to = readPoint(args, 'to');
      const shift: Point = [to[0] - from[0], to[1] - from[1]];
      for (const object of targets) {
        if (command === 'MOVE') session.replaceGeometry(object.handle, movedGeometry(object, shift));
        else session.createObject(object.type, movedGeometry(object, shift), object.layer);
      }
      return;
    }
    case 'ROTATE': {
      const base = readPoint(args, 'base');
      const angle = readNumber(args, 'angle');
      for (const object of targets) {
        session.replaceGeometry(object.handle, rotatedGeometry(object, base, angle));
      }
      return;
    }
    case 'SCALE': {
      const base = readPoint(args, 'base');
      const factor = readPositive(args, 'factor');
      for (const object of targets) {
        session.replaceGeometry(object.handle, scaledGeometry(object, base, factor));
      }
      return;
    }
    case 'MIRROR': {
      const first = readPoint(args, 'first');
      const second = readPoint(args, 'second');
      const eraseSource = readBoolean(args, 'erase_source');
      for (const object of targets) {
        const geometry = mirroredGeometry(object, first, second);
        if (eraseSource) session.replaceGeometry(object.handle, geometry);
        else session.createObject(object.type, geometry, object.layer);
      }
      return;
    }
    case 'ERASE': {
      for (const object of targets) session.eraseObject(object.handle);
      return;
    }
    default:
      invalid('command', 'Unknown command.');
  }
}

function applyModifyCommand(command: string, context: Context): void {
  const { session, args } = context;
  if (command === 'OFFSET') {
    const handle = readHandle(args, 'handle');
    const offsetDistance = readPositive(args, 'distance');
    const side = readPoint(args, 'side');
    requireObject(session, handle);
    const object = singleEditable(session, handle);
    if (object === null) return;
    const geometry = offsetGeometry(object, offsetDistance, side);
    if (geometry === null) {
      session.history = copy.history.positiveNumber;
      return;
    }
    session.createObject(object.type, geometry, object.layer);
    return;
  }
  if (command === 'TRIM' || command === 'EXTEND') {
    const handle = readHandle(args, 'handle');
    const pick = readPoint(args, 'pick');
    requireObject(session, handle);
    const object = singleEditable(session, handle);
    if (object === null) return;
    const edges = visibleEdges(session);
    if (command === 'TRIM') {
      const outcome = trimObject(object, pick, edges);
      if (outcome.kind === 'no_edge') {
        session.history = copy.history.noCuttingEdge;
        return;
      }
      if (outcome.kind === 'erase') {
        session.eraseObject(object.handle);
        return;
      }
      if (outcome.kind === 'modify') {
        session.replaceGeometry(object.handle, outcome.data, outcome.type);
        return;
      }
      session.replaceGeometry(object.handle, outcome.keep, outcome.type);
      session.createObject(outcome.type, outcome.extra, object.layer);
      return;
    }
    const outcome = extendObject(object, pick, edges);
    if (outcome.kind === 'no_edge') {
      session.history = copy.history.noCuttingEdge;
      return;
    }
    session.replaceGeometry(object.handle, outcome.data);
    return;
  }
  if (command === 'FILLET') {
    const handles = readHandles(args, 'handles');
    if (handles.length !== 2) invalid('handles', copy.history.noObjectFound);
    const radius = readNumber(args, 'radius');
    if (radius < 0) invalid('radius', copy.history.positiveNumber);
    requireObject(session, handles[0]!);
    requireObject(session, handles[1]!);
    const editable = session.editable(handles);
    if (editable.length < 2) return;
    const [first, second] = editable as [StoredObject, StoredObject];
    const result = filletLines(first, second, radius);
    if (result === null) {
      session.history = copy.history.noCuttingEdge;
      return;
    }
    session.replaceGeometry(first.handle, result.first);
    session.replaceGeometry(second.handle, result.second);
    if (result.arc !== null) session.createObject('arc', result.arc, first.layer);
    return;
  }
  invalid('command', 'Unknown command.');
}

function applyDimensionCommand(command: string, context: Context): void {
  const { session, args } = context;
  if (command === 'DIMLINEAR' || command === 'DIMALIGNED') {
    session.createObject('dimension', {
      kind: command === 'DIMLINEAR' ? 'linear' : 'aligned',
      points: [readPoint(args, 'first'), readPoint(args, 'second')],
      location: readPoint(args, 'location'),
      text_override: null,
      handles: [],
    });
    return;
  }
  if (command === 'DIMRADIUS') {
    const handle = readHandle(args, 'handle');
    const target = requireObject(session, handle);
    if (target.type !== 'circle' && target.type !== 'arc') invalid('handles', copy.history.noObjectFound);
    const center = target.type === 'circle' ? asCircle(target).center : asArc(target).center;
    session.createObject('dimension', {
      kind: 'radius',
      points: [center],
      location: readPoint(args, 'location'),
      text_override: null,
      handles: [handle],
    });
    return;
  }
  const firstHandle = readHandle(args, 'first_handle');
  const secondHandle = readHandle(args, 'second_handle');
  const first = requireObject(session, firstHandle);
  const second = requireObject(session, secondHandle);
  if (first.type !== 'line' || second.type !== 'line') invalid('handles', copy.history.noObjectFound);
  session.createObject('dimension', {
    kind: 'angular',
    points: [],
    location: readPoint(args, 'location'),
    text_override: null,
    handles: [firstHandle, secondHandle],
  });
}

const DRAW_COMMANDS = new Set(['LINE', 'PLINE', 'RECTANG', 'CIRCLE', 'ARC', 'POLYGON', 'SPLINE', 'MTEXT', 'INSERT']);
const TRANSFORM_COMMANDS = new Set(['MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'ERASE']);
const MODIFY_COMMANDS = new Set(['OFFSET', 'TRIM', 'EXTEND', 'FILLET']);
const DIMENSION_COMMANDS = new Set(['DIMLINEAR', 'DIMALIGNED', 'DIMRADIUS', 'DIMANGULAR']);
const ZERO_OBJECT_COMMANDS = new Set(['LAYER', 'LAYOUT', 'XREF']);

interface VersionRow {
  version: number;
  command: string;
  before_state: VersionSnapshot;
  after_state: VersionSnapshot;
}

async function applyUndo(context: Context): Promise<void> {
  const { client, record, actor, session } = context;
  const candidate = await queryOn<VersionRow>(client, 
    `select version, command, before_state, after_state from drawing_versions
     where drawing_id = $1 and actor_key = $2 and undone = false and command <> all($3)
     order by version desc limit 1`,
    [record.id, actor.key, [...NO_UNDO_COMMANDS]],
  );
  const row = candidate[0];
  if (row === undefined) {
    session.history = copy.history.nothingToUndo;
    return;
  }
  session.applySnapshot(row.before_state);
  await client.query('update drawing_versions set undone = true where drawing_id = $1 and version = $2', [
    record.id,
    row.version,
  ]);
  session.history = copy.history.undo(row.command);
}

async function applyRedo(context: Context): Promise<void> {
  const { client, record, actor, session } = context;
  const candidate = await queryOn<VersionRow>(client, 
    `select version, command, before_state, after_state from drawing_versions
     where drawing_id = $1 and actor_key = $2 and undone = true and redo_blocked = false and command <> all($3)
     order by version desc limit 1`,
    [record.id, actor.key, [...NO_UNDO_COMMANDS]],
  );
  const row = candidate[0];
  if (row === undefined) {
    session.history = copy.history.nothingToRedo;
    return;
  }
  session.applySnapshot(row.after_state);
  await client.query('update drawing_versions set undone = false where drawing_id = $1 and version = $2', [
    record.id,
    row.version,
  ]);
  session.history = copy.history.redo(row.command);
}

export interface RunCommandOptions {
  drawingId: string;
  actor: CommandActor;
  baseVersion: number;
  command: string;
  args: unknown;
  zone: string;
  now: Date;
}

/** The one place a base edit is checked against the drawing version and applied. */
export async function runCommand(options: RunCommandOptions): Promise<CommandOutcome> {
  return await transaction(async (client) => {
    const locked = await lockDrawingRecord(client, options.drawingId);
    if (locked === null) fail('not_found');
    if (locked.version !== options.baseVersion) {
      const versionRows = await queryOn<{ handles: string[] }>(client, 
        `select coalesce(created_handles,'{}') || coalesce(modified_handles,'{}') || coalesce(erased_handles,'{}') as handles
         from drawing_versions where drawing_id = $1 and version > $2`,
        [options.drawingId, options.baseVersion],
      );
      const changed = [...new Set(versionRows.flatMap((row) => row.handles))].sort(compareHandles);
      throw new ApiError('version_conflict', { current_version: locked.version, changed });
    }

    const state = await loadDrawingState(options.drawingId, client);
    if (state === null) fail('not_found');
    const session = new EditSession(state);
    const context: Context = {
      session,
      args: argsOf(options.args),
      actor: options.actor,
      client,
      record: locked,
    };

    const command = options.command;
    if (DRAW_COMMANDS.has(command)) applyDrawCommand(command, context);
    else if (TRANSFORM_COMMANDS.has(command)) applyTransformCommand(command, context);
    else if (MODIFY_COMMANDS.has(command)) applyModifyCommand(command, context);
    else if (DIMENSION_COMMANDS.has(command)) applyDimensionCommand(command, context);
    else if (command === 'PROPERTIES') applyProperties(context);
    else if (command === 'LAYER') applyLayer(context);
    else if (command === 'LAYOUT') applyLayout(context);
    else if (command === 'XREF') await applyXref(context);
    else if (command === 'UNDO') await applyUndo(context);
    else if (command === 'REDO') await applyRedo(context);
    else invalid('command', 'Unknown command.');

    session.finishLockedHistory();

    if (!session.hasChanges) {
      return {
        version: locked.version,
        created: [],
        modified: [],
        erased: [],
        locked: session.lockedOut,
        objects: [],
        history: session.history,
        changed: [],
        activity: null,
      };
    }

    if (!NO_UNDO_COMMANDS.has(command)) {
      await client.query(
        'update drawing_versions set redo_blocked = true where drawing_id = $1 and actor_key = $2 and undone = true',
        [options.drawingId, options.actor.key],
      );
    }

    const version = await persistSession(client, options.drawingId, session, options.now);
    const created = [...session.created].sort(compareHandles);
    const modified = [...session.modified].sort(compareHandles);
    const erased = [...session.erased].sort(compareHandles);

    await client.query(
      `insert into drawing_versions (drawing_id, version, actor, actor_key, command, created_handles,
        modified_handles, erased_handles, before_state, after_state, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        options.drawingId,
        version,
        options.actor.name,
        options.actor.key,
        command,
        created,
        modified,
        erased,
        JSON.stringify(session.beforeSnapshot()),
        JSON.stringify(session.afterSnapshot()),
        options.now,
      ],
    );

    const verb: ActivityEntry['verb'] =
      created.length > 0 && modified.length === 0 && erased.length === 0
        ? 'created'
        : erased.length > 0 && created.length === 0 && modified.length === 0
          ? 'erased'
          : 'modified';
    const activityCount = ZERO_OBJECT_COMMANDS.has(command)
      ? 0
      : new Set([...created, ...modified, ...erased]).size;
    const text = `${formatClockTime(options.now, options.zone)} · ${options.actor.name} · ${command} · ${objectCount(activityCount)} ${verb}`;
    await client.query(
      'insert into activity (drawing_id, at, actor, command, count, verb, text) values ($1,$2,$3,$4,$5,$6,$7)',
      [options.drawingId, options.now, options.actor.name, command, activityCount, verb, text],
    );

    const all = new Map([...session.objects.values()].map((object) => [object.handle, object]));
    const touched = [...created, ...modified]
      .map((handle) => session.objects.get(handle))
      .filter((object): object is StoredObject => object !== undefined);

    return {
      version,
      created,
      modified,
      erased,
      locked: session.lockedOut,
      objects: touched.map((object) => serializeObject(object, all, session.units)),
      history: session.history,
      changed: session.changedHandles,
      activity: {
        at: options.now.toISOString(),
        actor: options.actor.name,
        command,
        count: activityCount,
        verb,
        text,
      },
    };
  });
}
