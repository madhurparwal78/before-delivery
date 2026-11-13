import type { ColorName, ObjectType, Point } from '../shared/api';
import { LINETYPE_NAMES } from '../shared/api';
import type { Units } from '../shared/format';
import { BLOCK_LIBRARY, isBlockName } from './blocks';
import type { DrawingState, LayerRecord } from './drawings';
import { isLayerVisible } from './drawings';
import { wrap360 } from './geometry';
import {
  asArc,
  asCircle,
  asInsert,
  asLine,
  asMText,
  asPolyline,
  asSpline,
  type ObjectGeometry,
  type StoredObject,
} from './model';
import { renderDimension } from './render';

const ACI_BY_COLOR: Record<ColorName, number> = {
  Red: 1,
  Yellow: 2,
  Green: 3,
  Cyan: 4,
  Blue: 5,
  Magenta: 6,
  White: 7,
};

const COLOR_BY_ACI = new Map<number, ColorName>(
  (Object.entries(ACI_BY_COLOR) as Array<[ColorName, number]>).map(([name, aci]) => [aci, name]),
);

/** Group codes whose value is a plain integer rather than a real. */
const INTEGER_CODES = new Set([62, 70, 71, 72, 73, 90]);

class DxfWriter {
  private readonly lines: string[] = [];

  pair(code: number, value: string | number): void {
    this.lines.push(String(code));
    if (typeof value !== 'number') this.lines.push(value);
    else this.lines.push(INTEGER_CODES.has(code) ? String(Math.round(value)) : formatDxfNumber(value));
  }

  text(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

function formatDxfNumber(value: number): string {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

function layerFlags(layer: LayerRecord): number {
  return (layer.frozen ? 1 : 0) + (layer.locked ? 4 : 0);
}

/** Plain ASCII DXF of the drawing's layer table and supported entities. */
export function writeDxf(state: DrawingState): string {
  const units = state.record.units;
  const factor = units === 'm' ? 0.001 : 1;
  const writer = new DxfWriter();
  const all = new Map(state.objects.map((object) => [object.handle, object]));

  writer.pair(0, 'SECTION');
  writer.pair(2, 'HEADER');
  writer.pair(9, '$INSUNITS');
  writer.pair(70, units === 'm' ? 6 : 4);
  writer.pair(0, 'ENDSEC');

  writer.pair(0, 'SECTION');
  writer.pair(2, 'TABLES');
  writer.pair(0, 'TABLE');
  writer.pair(2, 'LAYER');
  writer.pair(70, state.layers.length);
  for (const layer of state.layers) {
    const aci = ACI_BY_COLOR[layer.color as ColorName] ?? 7;
    writer.pair(0, 'LAYER');
    writer.pair(2, layer.name);
    writer.pair(70, layerFlags(layer));
    writer.pair(62, layer.on ? aci : -aci);
    writer.pair(6, layer.linetype);
  }
  writer.pair(0, 'ENDTAB');
  writer.pair(0, 'ENDSEC');

  const blocksInUse = [
    ...new Set(
      state.objects
        .filter((object) => object.type === 'insert' && isLayerVisible(state.layers, object.layer))
        .map((object) => asInsert(object).block)
        .filter(isBlockName),
    ),
  ];
  writer.pair(0, 'SECTION');
  writer.pair(2, 'BLOCKS');
  for (const name of blocksInUse) {
    writer.pair(0, 'BLOCK');
    writer.pair(2, name);
    writer.pair(70, 0);
    writer.pair(10, 0);
    writer.pair(20, 0);
    for (const part of BLOCK_LIBRARY[name]) {
      if (part.kind === 'line') {
        writer.pair(0, 'LINE');
        writer.pair(8, '0');
        writer.pair(10, part.start[0] * factor);
        writer.pair(20, part.start[1] * factor);
        writer.pair(11, part.end[0] * factor);
        writer.pair(21, part.end[1] * factor);
      } else if (part.kind === 'arc') {
        writer.pair(0, 'ARC');
        writer.pair(8, '0');
        writer.pair(10, part.center[0] * factor);
        writer.pair(20, part.center[1] * factor);
        writer.pair(40, part.radius * factor);
        writer.pair(50, part.start_angle);
        writer.pair(51, part.end_angle);
      } else if (part.kind === 'polyline') {
        writer.pair(0, 'LWPOLYLINE');
        writer.pair(8, '0');
        writer.pair(90, part.vertices.length);
        writer.pair(70, part.closed ? 1 : 0);
        for (const vertex of part.vertices) {
          writer.pair(10, vertex[0] * factor);
          writer.pair(20, vertex[1] * factor);
        }
      } else {
        writer.pair(0, 'MTEXT');
        writer.pair(8, '0');
        writer.pair(10, part.position[0] * factor);
        writer.pair(20, part.position[1] * factor);
        writer.pair(40, part.height * factor);
        writer.pair(1, part.contents);
      }
    }
    writer.pair(0, 'ENDBLK');
  }
  writer.pair(0, 'ENDSEC');

  writer.pair(0, 'SECTION');
  writer.pair(2, 'ENTITIES');
  for (const object of state.objects) {
    if (!isLayerVisible(state.layers, object.layer)) continue;
    writeEntity(writer, object, all, units, factor);
  }
  writer.pair(0, 'ENDSEC');
  writer.pair(0, 'EOF');
  return writer.text();
}

function writeEntity(
  writer: DxfWriter,
  object: StoredObject,
  all: Map<string, StoredObject>,
  units: Units,
  factor: number,
): void {
  const head = (type: string): void => {
    writer.pair(0, type);
    writer.pair(5, object.handle);
    writer.pair(8, object.layer);
  };
  switch (object.type) {
    case 'line': {
      const line = asLine(object);
      head('LINE');
      writer.pair(10, line.start[0] * factor);
      writer.pair(20, line.start[1] * factor);
      writer.pair(11, line.end[0] * factor);
      writer.pair(21, line.end[1] * factor);
      return;
    }
    case 'circle': {
      const circle = asCircle(object);
      head('CIRCLE');
      writer.pair(10, circle.center[0] * factor);
      writer.pair(20, circle.center[1] * factor);
      writer.pair(40, circle.radius * factor);
      return;
    }
    case 'arc': {
      const arc = asArc(object);
      head('ARC');
      writer.pair(10, arc.center[0] * factor);
      writer.pair(20, arc.center[1] * factor);
      writer.pair(40, arc.radius * factor);
      writer.pair(50, wrap360(arc.start_angle));
      writer.pair(51, wrap360(arc.end_angle));
      return;
    }
    case 'polyline': {
      const polyline = asPolyline(object);
      head('LWPOLYLINE');
      writer.pair(90, polyline.vertices.length);
      writer.pair(70, polyline.closed ? 1 : 0);
      for (const vertex of polyline.vertices) {
        writer.pair(10, vertex[0] * factor);
        writer.pair(20, vertex[1] * factor);
      }
      return;
    }
    case 'spline': {
      const spline = asSpline(object);
      head('LWPOLYLINE');
      writer.pair(90, spline.fit_points.length);
      writer.pair(70, 0);
      for (const vertex of spline.fit_points) {
        writer.pair(10, vertex[0] * factor);
        writer.pair(20, vertex[1] * factor);
      }
      return;
    }
    case 'mtext': {
      const text = asMText(object);
      head('MTEXT');
      writer.pair(10, text.position[0] * factor);
      writer.pair(20, text.position[1] * factor);
      writer.pair(40, text.height * factor);
      writer.pair(41, text.width * factor);
      writer.pair(1, text.contents);
      return;
    }
    case 'insert': {
      const insert = asInsert(object);
      head('INSERT');
      writer.pair(2, insert.block);
      writer.pair(10, insert.position[0] * factor);
      writer.pair(20, insert.position[1] * factor);
      writer.pair(41, insert.scale);
      writer.pair(42, insert.scale);
      writer.pair(50, wrap360(insert.rotation));
      return;
    }
    case 'dimension': {
      const rendered = renderDimension(object, all, units);
      for (const curve of rendered.curves) {
        if (curve.kind !== 'segment') continue;
        head('LINE');
        writer.pair(10, curve.a[0] * factor);
        writer.pair(20, curve.a[1] * factor);
        writer.pair(11, curve.b[0] * factor);
        writer.pair(21, curve.b[1] * factor);
      }
      for (const text of rendered.texts) {
        head('MTEXT');
        writer.pair(10, text.position[0] * factor);
        writer.pair(20, text.position[1] * factor);
        writer.pair(40, text.height * factor);
        writer.pair(1, text.text);
      }
      return;
    }
    case 'revcloud':
      return;
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface DxfImportLayer {
  name: string;
  color: ColorName;
  linetype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
}

export interface DxfImportObject {
  type: ObjectType;
  layer: string;
  data: ObjectGeometry;
}

export interface DxfImportResult {
  units: Units;
  layers: DxfImportLayer[];
  objects: DxfImportObject[];
  imported: number;
  skipped: number;
}

interface GroupPair {
  code: number;
  value: string;
}

function readPairs(text: string): GroupPair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: GroupPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i]!.trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1]! .trim() });
  }
  return pairs;
}

/** A DXF drawing is ASCII text starting with 0/SECTION and holding 0/EOF. */
export function looksLikeDxf(buffer: Buffer): boolean {
  if (buffer.some((byte) => byte === 0)) return false;
  const text = buffer.toString('latin1');
  const pairs = readPairs(text);
  const first = pairs[0];
  if (first === undefined || first.code !== 0 || first.value !== 'SECTION') return false;
  return pairs.some((pair) => pair.code === 0 && pair.value === 'EOF');
}

const SUPPORTED_ENTITIES = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'MTEXT', 'INSERT']);

export function parseDxf(text: string): DxfImportResult {
  const pairs = readPairs(text);
  let units: Units = 'mm';
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i]!.code === 9 && pairs[i]!.value === '$INSUNITS') {
      const next = pairs[i + 1]!;
      if (next.code === 70) units = next.value === '6' ? 'm' : 'mm';
    }
  }
  const factor = units === 'm' ? 1000 : 1;

  const layers: DxfImportLayer[] = [];
  const objects: DxfImportObject[] = [];
  let skipped = 0;

  let section = '';
  let tableName = '';
  let current: { type: string; codes: Map<number, string>; repeated: Array<[number, string]> } | null = null;

  const flush = (): void => {
    if (current === null) return;
    const entity = current;
    current = null;
    if (section === 'TABLES' && tableName === 'LAYER' && entity.type === 'LAYER') {
      const name = entity.codes.get(2) ?? '0';
      const aci = Number.parseInt(entity.codes.get(62) ?? '7', 10);
      const flags = Number.parseInt(entity.codes.get(70) ?? '0', 10);
      const linetype = entity.codes.get(6) ?? 'Continuous';
      layers.push({
        name,
        color: COLOR_BY_ACI.get(Math.abs(aci)) ?? 'White',
        linetype: (LINETYPE_NAMES as readonly string[]).includes(linetype) ? linetype : 'Continuous',
        on: aci >= 0,
        frozen: (flags & 1) === 1,
        locked: (flags & 4) === 4,
      });
      return;
    }
    if (section !== 'ENTITIES') return;
    if (!SUPPORTED_ENTITIES.has(entity.type)) {
      skipped += 1;
      return;
    }
    const layer = entity.codes.get(8) ?? '0';
    const number = (code: number, fallback = 0): number => {
      const raw = entity.codes.get(code);
      if (raw === undefined) return fallback;
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const xs = entity.repeated.filter(([code]) => code === 10).map(([, value]) => Number.parseFloat(value));
    const ys = entity.repeated.filter(([code]) => code === 20).map(([, value]) => Number.parseFloat(value));
    switch (entity.type) {
      case 'LINE':
        objects.push({
          type: 'line',
          layer,
          data: {
            start: [number(10) * factor, number(20) * factor],
            end: [number(11) * factor, number(21) * factor],
          },
        });
        return;
      case 'CIRCLE':
        objects.push({
          type: 'circle',
          layer,
          data: { center: [number(10) * factor, number(20) * factor], radius: number(40) * factor },
        });
        return;
      case 'ARC':
        objects.push({
          type: 'arc',
          layer,
          data: {
            center: [number(10) * factor, number(20) * factor],
            radius: number(40) * factor,
            start_angle: wrap360(number(50)),
            end_angle: wrap360(number(51)),
          },
        });
        return;
      case 'LWPOLYLINE': {
        const vertices: Point[] = [];
        for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
          vertices.push([xs[i]! * factor, ys[i]! * factor]);
        }
        if (vertices.length < 2) {
          skipped += 1;
          return;
        }
        objects.push({ type: 'polyline', layer, data: { vertices, closed: (number(70) & 1) === 1 } });
        return;
      }
      case 'MTEXT':
        objects.push({
          type: 'mtext',
          layer,
          data: {
            position: [number(10) * factor, number(20) * factor],
            width: number(41, 1200) * factor,
            height: number(40, 250) * factor,
            contents: entity.codes.get(1) ?? '',
          },
        });
        return;
      case 'INSERT': {
        const block = entity.codes.get(2) ?? '';
        if (!isBlockName(block)) {
          skipped += 1;
          return;
        }
        objects.push({
          type: 'insert',
          layer,
          data: {
            block,
            position: [number(10) * factor, number(20) * factor],
            scale: number(41, 1) === 0 ? 1 : number(41, 1),
            rotation: wrap360(number(50)),
          },
        });
        return;
      }
      default:
        skipped += 1;
    }
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i]!;
    if (pair.code === 0) {
      flush();
      if (pair.value === 'SECTION') {
        const next = pairs[i + 1];
        section = next !== undefined && next.code === 2 ? next.value : '';
        tableName = '';
        continue;
      }
      if (pair.value === 'ENDSEC' || pair.value === 'EOF') {
        section = '';
        continue;
      }
      if (pair.value === 'TABLE') {
        const next = pairs[i + 1];
        tableName = next !== undefined && next.code === 2 ? next.value : '';
        continue;
      }
      if (pair.value === 'ENDTAB') {
        tableName = '';
        continue;
      }
      current = { type: pair.value, codes: new Map(), repeated: [] };
      continue;
    }
    if (current === null) continue;
    current.repeated.push([pair.code, pair.value]);
    if (!current.codes.has(pair.code)) current.codes.set(pair.code, pair.value);
  }
  flush();

  const layerNames = new Set(layers.map((layer) => layer.name));
  if (!layerNames.has('0')) {
    layers.unshift({ name: '0', color: 'White', linetype: 'Continuous', on: true, frozen: false, locked: false });
    layerNames.add('0');
  }
  for (const object of objects) {
    if (!layerNames.has(object.layer)) {
      layers.push({
        name: object.layer,
        color: 'White',
        linetype: 'Continuous',
        on: true,
        frozen: false,
        locked: false,
      });
      layerNames.add(object.layer);
    }
  }

  return { units, layers, objects, imported: objects.length, skipped };
}
