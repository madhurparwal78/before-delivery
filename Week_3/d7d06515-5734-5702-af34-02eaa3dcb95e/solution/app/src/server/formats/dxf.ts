// DXF export and import (brief: Business rules > DXF export / DXF import). Pure.
import type { DrawingModel } from '../engine/types.ts';
import { primitivesOf } from '../../shared/geometry.ts';
import { LINETYPE_DASH } from '../../shared/sheet.ts';
import { BLOCK_NAMES, COLOR_NAMES, LINETYPES } from '../../shared/types.ts';
import type { BlockName, ColorName, Geometry, Layer, LinetypeName, Point, Primitive, StoredObject, Units } from '../../shared/types.ts';
import { trimmed } from './numbers.ts';

const ACI: Record<ColorName, number> = { Red: 1, Yellow: 2, Green: 3, Cyan: 4, Blue: 5, Magenta: 6, White: 7 };
const FLAG_FROZEN = 1;
const FLAG_LOCKED = 4;
const INSUNITS_MM = 4;
const INSUNITS_M = 6;
const MM_PER_M = 1000;
const FIRST_IMPORTED_HANDLE = 0x10;
const DEFAULT_LAYER = '0';
const DEFAULT_LINEWEIGHT = '0.25 mm';
const DEFAULT_TEXT_HEIGHT_MM = 250;
const ESTIMATED_GLYPH_WIDTH = 0.6;
const FILE_VERSION = 'AC1015';

function hex(value: number): string {
  return value.toString(16).toUpperCase();
}

interface HandleCounter { next: number }

/** Group-code/value writer with the file's coordinate scale; sections share one handle counter. */
class Writer {
  readonly lines: string[] = [];
  private readonly factor: number;
  private readonly handles: HandleCounter;
  private readonly places: number;

  constructor(factor: number, handles: HandleCounter) {
    this.factor = factor;
    this.handles = handles;
    this.places = factor === 1 ? 6 : 9;
  }

  section(): Writer {
    return new Writer(this.factor, this.handles);
  }

  group(code: number, value: string | number): void {
    this.lines.push(String(code), String(value));
  }

  /** Writes a length or coordinate (millimetres in, current units out). */
  length(code: number, millimetres: number): void {
    this.group(code, trimmed(millimetres * this.factor, this.places));
  }

  plain(code: number, value: number): void {
    this.group(code, trimmed(value, 6));
  }

  point(code: number, at: Point): void {
    this.length(code, at[0]);
    this.length(code + 10, at[1]);
  }

  newHandle(): string {
    const handle = hex(this.handles.next);
    this.handles.next += 1;
    return handle;
  }

  get seed(): string {
    return hex(this.handles.next);
  }
}

/** MTEXT contents as ASCII: control characters escaped, anything outside ASCII as a `\U+XXXX` code. */
function mtextEscape(text: string): string {
  return text
    .replace(/[\\{}]/g, (char) => `\\${char}`)
    .replace(/\r?\n/g, '\\P')
    .replace(/[^\x20-\x7e]/g, (char) => `\\U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

function textWidth(text: string, height: number): number {
  return Math.max(0, ...text.split('\n').map((line) => line.length)) * height * ESTIMATED_GLYPH_WIDTH;
}

interface EntityLook { layer: string; color: 'ByLayer' | ColorName; linetype: 'ByLayer' | LinetypeName }

function entityHead(w: Writer, type: string, handle: string, look: EntityLook, subclass: string): void {
  w.group(0, type);
  w.group(5, handle);
  w.group(100, 'AcDbEntity');
  w.group(8, look.layer);
  if (look.color !== 'ByLayer') w.group(62, ACI[look.color]);
  if (look.linetype !== 'ByLayer') w.group(6, look.linetype);
  w.group(100, subclass);
}

function writePolyline(w: Writer, handle: string, look: EntityLook, points: Point[], closed: boolean): void {
  entityHead(w, 'LWPOLYLINE', handle, look, 'AcDbPolyline');
  w.group(90, points.length);
  w.group(70, closed ? 1 : 0);
  for (const point of points) w.point(10, point);
}

function writeMText(w: Writer, handle: string, look: EntityLook, at: Point, height: number, width: number, contents: string): void {
  entityHead(w, 'MTEXT', handle, look, 'AcDbMText');
  w.point(10, at);
  w.length(40, height);
  w.length(41, width);
  w.group(1, mtextEscape(contents));
}

function writePrimitive(w: Writer, handle: string, look: EntityLook, primitive: Primitive): void {
  if (primitive.kind === 'line') {
    entityHead(w, 'LINE', handle, look, 'AcDbLine');
    w.point(10, primitive.a);
    w.point(11, primitive.b);
  } else if (primitive.kind === 'polyline') {
    writePolyline(w, handle, look, primitive.points, primitive.closed);
  } else if (primitive.kind === 'circle') {
    entityHead(w, 'CIRCLE', handle, look, 'AcDbCircle');
    w.point(10, primitive.center);
    w.length(40, primitive.radius);
  } else if (primitive.kind === 'arc') {
    entityHead(w, 'ARC', handle, look, 'AcDbCircle');
    w.point(10, primitive.center);
    w.length(40, primitive.radius);
    w.group(100, 'AcDbArc');
    w.plain(50, primitive.start_angle);
    w.plain(51, primitive.end_angle);
  } else {
    const width = primitive.width ?? textWidth(primitive.text, primitive.height);
    writeMText(w, handle, look, primitive.at, primitive.height, width, primitive.text);
  }
}

/** Writes one object as DXF entities; the object's own handle goes on its first entity. */
function writeObject(w: Writer, object: StoredObject, model: DrawingModel): void {
  const look: EntityLook = { layer: object.layer, color: object.color, linetype: object.linetype };
  switch (object.type) {
    case 'line':
      writePrimitive(w, object.handle, look, { kind: 'line', a: object.start, b: object.end });
      return;
    case 'polyline':
      writePolyline(w, object.handle, look, object.vertices, object.closed);
      return;
    case 'circle':
      writePrimitive(w, object.handle, look, { kind: 'circle', center: object.center, radius: object.radius });
      return;
    case 'arc':
      writePrimitive(w, object.handle, look, {
        kind: 'arc', center: object.center, radius: object.radius, start_angle: object.start_angle, end_angle: object.end_angle,
      });
      return;
    case 'spline':
      writePolyline(w, object.handle, look, object.fit_points, false);
      return;
    case 'mtext':
      writeMText(w, object.handle, look, object.position, object.height, object.width, object.contents);
      return;
    case 'insert':
      entityHead(w, 'INSERT', object.handle, look, 'AcDbBlockReference');
      w.group(2, object.block);
      w.point(10, object.position);
      w.plain(41, object.scale);
      w.plain(42, object.scale);
      w.plain(50, object.rotation);
      return;
    case 'dimension':
    case 'revcloud':
      primitivesOf(object, model.units).forEach((primitive, index) => {
        writePrimitive(w, index === 0 ? object.handle : w.newHandle(), look, primitive);
      });
      return;
  }
}

function blockObject(block: BlockName): StoredObject {
  return {
    handle: '0', layer: DEFAULT_LAYER, color: 'ByLayer', linetype: 'ByLayer', linetype_scale: 1, lineweight: 'ByLayer',
    dimension_style: 'Standard', text_style: 'Standard', multileader_style: 'Standard',
    type: 'insert', block, position: [0, 0], scale: 1, rotation: 0,
  };
}

function writeTables(w: Writer, model: DrawingModel, blocks: BlockName[]): void {
  const table = (name: string, count: number, records: () => void): void => {
    w.group(0, 'TABLE');
    w.group(2, name);
    w.group(5, w.newHandle());
    w.group(100, 'AcDbSymbolTable');
    w.group(70, count);
    records();
    w.group(0, 'ENDTAB');
  };
  const record = (type: string, subclass: string): void => {
    w.group(0, type);
    w.group(5, w.newHandle());
    w.group(100, 'AcDbSymbolTableRecord');
    w.group(100, subclass);
  };

  w.group(0, 'SECTION');
  w.group(2, 'TABLES');
  table('LTYPE', LINETYPES.length, () => {
    for (const name of LINETYPES) {
      const dash = LINETYPE_DASH[name];
      record('LTYPE', 'AcDbLinetypeTableRecord');
      w.group(2, name);
      w.group(70, 0);
      w.group(3, name);
      w.group(72, 65);
      w.group(73, dash.length);
      w.group(40, dash.reduce((sum, length) => sum + length, 0));
      dash.forEach((length, index) => {
        w.group(49, index % 2 === 0 ? length : -length);
        w.group(74, 0);
      });
    }
  });
  table('LAYER', model.layers.length, () => {
    for (const layer of model.layers) {
      record('LAYER', 'AcDbLayerTableRecord');
      w.group(2, layer.name);
      w.group(70, (layer.frozen ? FLAG_FROZEN : 0) + (layer.locked ? FLAG_LOCKED : 0));
      w.group(62, layer.on ? ACI[layer.color] : -ACI[layer.color]);
      w.group(6, layer.linetype);
    }
  });
  table('STYLE', 1, () => {
    record('STYLE', 'AcDbTextStyleTableRecord');
    w.group(2, 'Standard');
    w.group(70, 0);
  });
  table('BLOCK_RECORD', blocks.length, () => {
    for (const block of blocks) {
      record('BLOCK_RECORD', 'AcDbBlockTableRecord');
      w.group(2, block);
    }
  });
  w.group(0, 'ENDSEC');
}

function writeBlocks(w: Writer, model: DrawingModel, blocks: BlockName[]): void {
  w.group(0, 'SECTION');
  w.group(2, 'BLOCKS');
  for (const block of blocks) {
    const look: EntityLook = { layer: DEFAULT_LAYER, color: 'ByLayer', linetype: 'ByLayer' };
    w.group(0, 'BLOCK');
    w.group(5, w.newHandle());
    w.group(100, 'AcDbEntity');
    w.group(8, DEFAULT_LAYER);
    w.group(100, 'AcDbBlockBegin');
    w.group(2, block);
    w.group(70, 0);
    w.point(10, [0, 0]);
    w.group(3, block);
    w.group(1, '');
    for (const primitive of primitivesOf(blockObject(block), model.units)) writePrimitive(w, w.newHandle(), look, primitive);
    w.group(0, 'ENDBLK');
    w.group(5, w.newHandle());
    w.group(100, 'AcDbEntity');
    w.group(8, DEFAULT_LAYER);
    w.group(100, 'AcDbBlockEnd');
  }
  w.group(0, 'ENDSEC');
}

/** Plain ASCII DXF: header, layer table, blocks in use, entities (frozen layers left out). */
export function exportDxf(model: DrawingModel): string {
  const frozen = new Set(model.layers.filter((layer) => layer.frozen).map((layer) => layer.name));
  const exported = model.objects.filter((object) => !frozen.has(object.layer));
  const blocks = BLOCK_NAMES.filter((name) => exported.some((object) => object.type === 'insert' && object.block === name));
  const root = new Writer(model.units === 'm' ? 1 / MM_PER_M : 1, { next: model.next_handle });

  // Entities first: a dimension's extra entities take the handles above next_handle, then tables and blocks continue after them.
  const entities = root.section();
  entities.group(0, 'SECTION');
  entities.group(2, 'ENTITIES');
  for (const object of exported) writeObject(entities, object, model);
  entities.group(0, 'ENDSEC');
  const tables = root.section();
  writeTables(tables, model, blocks);
  const blockSection = root.section();
  writeBlocks(blockSection, model, blocks);

  const header = root.section();
  header.group(0, 'SECTION');
  header.group(2, 'HEADER');
  header.group(9, '$ACADVER');
  header.group(1, FILE_VERSION);
  header.group(9, '$HANDSEED');
  header.group(5, header.seed);
  header.group(9, '$INSUNITS');
  header.group(70, model.units === 'm' ? INSUNITS_M : INSUNITS_MM);
  header.group(9, '$CLAYER');
  header.group(8, model.layers.find((layer) => layer.current)?.name ?? DEFAULT_LAYER);
  header.group(0, 'ENDSEC');

  const lines = [...header.lines, ...tables.lines, ...blockSection.lines, ...entities.lines, '0', 'EOF'];
  return `${lines.join('\n')}\n`;
}

const NUL = 0x00;
const ASCII_LIMIT = 0x80;

/** True when the bytes are an ASCII DXF: first group-code pair `0`/`SECTION` and an `0`/`EOF` somewhere. */
export function looksLikeDxf(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte === NUL || byte >= ASCII_LIMIT) return false;
  }
  const lines = bytes.toString('latin1').split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '0' || lines[1] !== 'SECTION') return false;
  return lines.some((line, index) => line === '0' && lines[index + 1] === 'EOF');
}

export interface DxfImport {
  units: Units;
  layers: Layer[];
  objects: StoredObject[];
  imported: number;
  skipped: number;
}

type Group = readonly [code: number, value: string];
interface DxfRecord { type: string; groups: Group[] }

const COMMENT_CODE = 999;

/** Tolerant group reader: a line that is not a group code is dropped and reading resumes at the next line. */
function readGroups(text: string): Group[] {
  const lines = text.split(/\r?\n/);
  const groups: Group[] = [];
  let index = 0;
  while (index + 1 < lines.length) {
    const code = /^\s*(-?\d+)\s*$/.exec(lines[index] ?? '');
    if (!code) {
      index += 1;
      continue;
    }
    const value = lines[index + 1] ?? '';
    index += 2;
    if (Number(code[1]) !== COMMENT_CODE) groups.push([Number(code[1]), value]);
  }
  return groups;
}

/** Sections by name, each split into records that start at a group 0. */
function readSections(groups: Group[]): Map<string, DxfRecord[]> {
  const sections = new Map<string, DxfRecord[]>();
  let records: DxfRecord[] | null = null;
  let expectName = false;
  for (const [code, value] of groups) {
    const word = value.trim();
    if (code === 0 && word === 'SECTION') {
      records = null;
      expectName = true;
    } else if (expectName && code === 2) {
      expectName = false;
      records = sections.get(word) ?? [];
      sections.set(word, records);
    } else if (code === 0 && word === 'ENDSEC') {
      records = null;
    } else if (records) {
      if (code === 0) records.push({ type: word, groups: [] });
      else records[records.length - 1]?.groups.push([code, value]);
    }
  }
  return sections;
}

function first(record: DxfRecord, code: number): string | undefined {
  return record.groups.find(([c]) => c === code)?.[1];
}

function numberOf(record: DxfRecord, code: number): number | null {
  const raw = first(record, code);
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function colorOf(aci: number | null): ColorName | null {
  return COLOR_NAMES.find((name) => ACI[name] === Math.abs(aci ?? 0)) ?? null;
}

function linetypeOf(name: string | undefined): LinetypeName | null {
  return LINETYPES.find((known) => known.toLowerCase() === name?.trim().toLowerCase()) ?? null;
}

const MTEXT_CODES = /\\([\\{}])|\\U\+([0-9A-Fa-f]{4})|\\P|\\~|\\[LlOoKk]|\\[A-Za-z][^;\\{}]*;|[{}]/g;

function mtextPlain(contents: string): string {
  return contents.replace(MTEXT_CODES, (match, literal: string | undefined, unicode: string | undefined) => {
    if (literal !== undefined) return literal;
    if (unicode !== undefined) return String.fromCharCode(Number.parseInt(unicode, 16));
    if (match === '\\P') return '\n';
    if (match === '\\~') return ' ';
    return '';
  });
}

function layerOf(record: DxfRecord): Layer | null {
  const name = first(record, 2)?.trim();
  if (!name) return null;
  const flags = numberOf(record, 70) ?? 0;
  const aci = numberOf(record, 62);
  return {
    name,
    color: colorOf(aci) ?? 'White',
    linetype: linetypeOf(first(record, 6)) ?? 'Continuous',
    lineweight: DEFAULT_LINEWEIGHT,
    on: aci === null || aci >= 0,
    frozen: (flags & FLAG_FROZEN) !== 0,
    locked: (flags & FLAG_LOCKED) !== 0,
    current: false,
  };
}

function readLayers(sections: Map<string, DxfRecord[]>): Layer[] {
  const layers: Layer[] = [];
  for (const record of sections.get('TABLES') ?? []) {
    const layer = record.type === 'LAYER' ? layerOf(record) : null;
    if (layer && !layers.some((existing) => existing.name.toLowerCase() === layer.name.toLowerCase())) layers.push(layer);
  }
  return layers;
}

function readUnits(groups: Group[]): Units {
  const at = groups.findIndex(([code, value]) => code === 9 && value.trim() === '$INSUNITS');
  const unit = at < 0 ? null : Number(groups[at + 1]?.[1]);
  return unit === INSUNITS_M ? 'm' : 'mm';
}

interface ImportScale {
  /** Coordinate in millimetres, rounded to 6 decimals. */
  coord(value: number): number;
}

function pointOf(record: DxfRecord, code: number, scale: ImportScale): Point | null {
  const x = numberOf(record, code);
  const y = numberOf(record, code + 10);
  return x === null || y === null ? null : [scale.coord(x), scale.coord(y)];
}

function angleOf(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) * 1e6) / 1e6;
}

function polylineVertices(record: DxfRecord, scale: ImportScale): Point[] | null {
  const vertices: [number, number | null][] = [];
  for (const [code, value] of record.groups) {
    const number = Number(value);
    if (!Number.isFinite(number) || value.trim() === '') {
      if (code === 10 || code === 20) return null;
      continue;
    }
    if (code === 10) vertices.push([scale.coord(number), null]);
    else if (code === 20 && vertices.length > 0) {
      const last = vertices[vertices.length - 1];
      if (last) last[1] = scale.coord(number);
    }
  }
  const points: Point[] = [];
  for (const [x, y] of vertices) {
    if (y === null) return null;
    points.push([x, y]);
  }
  return points.length >= 2 ? points : null;
}

/** The geometry of one ENTITIES record in the supported subset, or null when it must be skipped. */
function geometryOf(record: DxfRecord, scale: ImportScale): Geometry | null {
  switch (record.type) {
    case 'LINE': {
      const start = pointOf(record, 10, scale);
      const end = pointOf(record, 11, scale);
      return start && end ? { type: 'line', start, end } : null;
    }
    case 'CIRCLE': {
      const center = pointOf(record, 10, scale);
      const radius = numberOf(record, 40);
      return center && radius !== null && radius > 0 ? { type: 'circle', center, radius: scale.coord(radius) } : null;
    }
    case 'ARC': {
      const center = pointOf(record, 10, scale);
      const radius = numberOf(record, 40);
      const start = numberOf(record, 50);
      const end = numberOf(record, 51);
      if (!center || radius === null || radius <= 0 || start === null || end === null) return null;
      return { type: 'arc', center, radius: scale.coord(radius), start_angle: angleOf(start), end_angle: angleOf(end) };
    }
    case 'LWPOLYLINE': {
      const vertices = polylineVertices(record, scale);
      return vertices ? { type: 'polyline', vertices, closed: ((numberOf(record, 70) ?? 0) & 1) === 1 } : null;
    }
    case 'MTEXT': {
      const position = pointOf(record, 10, scale);
      const contents = mtextPlain(record.groups.filter(([code]) => code === 1 || code === 3).map(([, value]) => value).join(''));
      if (!position) return null;
      const rawHeight = numberOf(record, 40);
      const height = rawHeight !== null && rawHeight > 0 ? scale.coord(rawHeight) : DEFAULT_TEXT_HEIGHT_MM;
      const rawWidth = numberOf(record, 41);
      const width = rawWidth !== null && rawWidth > 0 ? scale.coord(rawWidth) : textWidth(contents, height);
      return { type: 'mtext', position, width, height, contents };
    }
    case 'INSERT': {
      const name = first(record, 2)?.trim().toLowerCase();
      const block = BLOCK_NAMES.find((known) => known.toLowerCase() === name);
      const position = pointOf(record, 10, scale);
      const insertScale = numberOf(record, 41) ?? 1;
      if (!block || !position || insertScale <= 0) return null;
      return { type: 'insert', block, position, scale: insertScale, rotation: angleOf(numberOf(record, 50) ?? 0) };
    }
    default:
      return null;
  }
}

/** Records that belong to a POLYLINE that was skipped already; they are not counted a second time. */
const FOLLOWERS = new Set(['VERTEX', 'SEQEND']);

/** Reads the exported subset; objects get handles 10, 11, ... in file order. Other entity types are skipped and counted. */
export function importDxf(text: string): DxfImport {
  const groups = readGroups(text);
  const sections = readSections(groups);
  const units = readUnits(sections.has('HEADER') ? groups : []);
  const factor = units === 'm' ? MM_PER_M : 1;
  const scale: ImportScale = { coord: (value) => Math.round(value * factor * 1e6) / 1e6 };
  const layers = readLayers(sections);
  const objects: StoredObject[] = [];
  let skipped = 0;

  for (const record of sections.get('ENTITIES') ?? []) {
    if (FOLLOWERS.has(record.type)) continue;
    const geometry = geometryOf(record, scale);
    if (!geometry) {
      skipped += 1;
      continue;
    }
    const named = first(record, 8)?.trim() || DEFAULT_LAYER;
    let layer = layers.find((existing) => existing.name.toLowerCase() === named.toLowerCase());
    if (!layer) {
      layer = { name: named, color: 'White', linetype: 'Continuous', lineweight: DEFAULT_LINEWEIGHT, on: true, frozen: false, locked: false, current: false };
      layers.push(layer);
    }
    const aci = numberOf(record, 62);
    objects.push({
      handle: hex(FIRST_IMPORTED_HANDLE + objects.length),
      layer: layer.name,
      color: (aci !== null && aci > 0 ? colorOf(aci) : null) ?? 'ByLayer',
      linetype: linetypeOf(first(record, 6)) ?? 'ByLayer',
      linetype_scale: 1,
      lineweight: 'ByLayer',
      dimension_style: 'Standard',
      text_style: 'Standard',
      multileader_style: 'Standard',
      ...geometry,
    });
  }

  if (!layers.some((layer) => layer.name === DEFAULT_LAYER)) {
    layers.unshift({ name: DEFAULT_LAYER, color: 'White', linetype: 'Continuous', lineweight: DEFAULT_LINEWEIGHT, on: true, frozen: false, locked: false, current: true });
  }
  for (const layer of layers) layer.current = layer.name === DEFAULT_LAYER;
  return { units, layers, objects, imported: objects.length, skipped };
}
