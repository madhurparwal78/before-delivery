// A3 landscape vector PDF sheet (brief: Business rules > PDF). Pure; no external renderer.
import { deflateSync } from 'node:zlib';
import type { DrawingModel } from '../engine/types.ts';
import { drawingExtents, styledPrimitivesOf } from '../../shared/geometry.ts';
import {
  BORDER, LINETYPE_DASH, SHEET, TITLE_BLOCK, VIEWPORT_FRAME, plotColor, titleBlockText, toSheet, viewportTransform,
} from '../../shared/sheet.ts';
import type { SheetRect, ViewportTransform } from '../../shared/sheet.ts';
import type { Point, StoredObject, ViewportScale } from '../../shared/types.ts';
import { trimmed } from './numbers.ts';

interface SheetInput {
  model: DrawingModel;
  /** `Model` or a paper layout name. */
  layout: string;
  /** Drawing name without `.dxf`. */
  title: string;
  /** Studio-zone issue date, YYYY-MM-DD. */
  issued: string;
  revision: string;
  note: string;
}

const POINTS_PER_MM = 72 / 25.4;
const FRAME_WEIGHT_MM = 0.35;
const BORDER_WEIGHT_MM = 0.5;
const MODEL_LAYOUT = 'Model';
const DEFAULT_VIEWPORT_SCALE: ViewportScale = '1:50';

const WIN_ANSI_EXTRAS: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const REPLACEMENT_BYTE = 0x3f;
// A text primitive's `at` is the top-left of its line box (one letter height tall); the baseline sits this fraction of it below the top.
const BASELINE_DROP = 0.8;

/** A PDF string literal in WinAnsi; glyphs the encoding lacks print as `?`. */
function pdfString(text: string): string {
  let out = '(';
  for (const char of text) {
    const code = char.codePointAt(0) ?? REPLACEMENT_BYTE;
    const byte = code >= 0x20 && code <= 0x7e ? code
      : code >= 0xa0 && code <= 0xff ? code
        : WIN_ANSI_EXTRAS[code] ?? (code === 0x0a || code === 0x09 ? 0x20 : REPLACEMENT_BYTE);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte > 0x7e) out += `\\${byte.toString(8)}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

function mm(value: number): string {
  return trimmed(value, 3);
}

function colorOps(rgb: readonly number[], stroke: boolean): string {
  const [r = 0, g = 0, b = 0] = rgb;
  return `${trimmed(r, 3)} ${trimmed(g, 3)} ${trimmed(b, 3)} ${stroke ? 'RG' : 'rg'}`;
}

function rect(r: SheetRect): string {
  return `${mm(r.x)} ${mm(r.y)} ${mm(r.width)} ${mm(r.height)} re`;
}

/** Counter-clockwise arc from `start` to `start + sweep` degrees as cubic curves of at most 90 degrees. */
function arcCurves(center: Point, radius: number, startDeg: number, sweepDeg: number): string[] {
  const segments = Math.max(1, Math.ceil(sweepDeg / 90 - 1e-9));
  const step = (sweepDeg / segments) * (Math.PI / 180);
  const handle = (4 / 3) * Math.tan(step / 4);
  const ops: string[] = [];
  let angle = (startDeg * Math.PI) / 180;
  for (let i = 0; i < segments; i += 1) {
    const next = angle + step;
    const [c0, s0, c1, s1] = [Math.cos(angle), Math.sin(angle), Math.cos(next), Math.sin(next)];
    const point = (x: number, y: number): string => `${mm(center[0] + radius * x)} ${mm(center[1] + radius * y)}`;
    ops.push(`${point(c0 - handle * s0, s0 + handle * c0)} ${point(c1 + handle * s1, s1 - handle * c1)} ${point(c1, s1)} c`);
    angle = next;
  }
  return ops;
}

function strokeState(state: { dash: string; weight: string; color: string }, dash: readonly number[], weightMm: number, color: string): string {
  const ops: string[] = [];
  const dashOp = dash.length === 0 ? '[] 0 d' : `[${dash.map(mm).join(' ')}] 0 d`;
  const weightOp = `${mm(weightMm)} w`;
  if (state.dash !== dashOp) ops.push(dashOp);
  if (state.weight !== weightOp) ops.push(weightOp);
  if (state.color !== color) ops.push(color);
  state.dash = dashOp;
  state.weight = weightOp;
  state.color = color;
  return ops.join('\n');
}

function viewportContent(input: SheetInput, transform: ViewportTransform): string[] {
  const { model } = input;
  const ops: string[] = [];
  const state = { dash: '', weight: '', color: '' };
  const hidden = new Set(model.layers.filter((layer) => layer.frozen || !layer.on).map((layer) => layer.name));
  const known = new Set(model.layers.map((layer) => layer.name));
  const drawn = (object: StoredObject): boolean => known.has(object.layer) && !hidden.has(object.layer);
  const toPoint = (point: Point): string => {
    const [x, y] = toSheet(transform, point);
    return `${mm(x)} ${mm(y)}`;
  };

  for (const object of model.objects.filter(drawn)) {
    for (const styled of styledPrimitivesOf(object, model.layers, model.units)) {
      const rgb = plotColor(model.plot_style, styled.color);
      const { primitive } = styled;
      if (primitive.kind === 'text') {
        const [x, y] = toSheet(transform, [primitive.at[0], primitive.at[1] - primitive.height * BASELINE_DROP]);
        const size = primitive.height * transform.factor;
        if (primitive.text.trim() === '' || size <= 0) continue;
        ops.push(`BT\n${colorOps(rgb, false)}\n/F1 ${mm(size)} Tf\n${mm(x)} ${mm(y)} Td\n${pdfString(primitive.text)} Tj\nET`);
        continue;
      }
      const dash = LINETYPE_DASH[styled.linetype].map((length) => length * object.linetype_scale);
      const setup = strokeState(state, dash, Number.parseFloat(styled.lineweight), colorOps(rgb, true));
      if (setup) ops.push(setup);
      if (primitive.kind === 'line') {
        ops.push(`${toPoint(primitive.a)} m ${toPoint(primitive.b)} l S`);
      } else if (primitive.kind === 'polyline') {
        const [first, ...rest] = primitive.points;
        if (!first) continue;
        ops.push(`${toPoint(first)} m ${rest.map((point) => `${toPoint(point)} l`).join(' ')}${primitive.closed ? ' h' : ''} S`);
      } else if (primitive.kind === 'circle') {
        const [cx, cy] = toSheet(transform, primitive.center);
        const r = primitive.radius * transform.factor;
        ops.push(`${mm(cx + r)} ${mm(cy)} m ${arcCurves([cx, cy], r, 0, 360).join(' ')} h S`);
      } else {
        const [cx, cy] = toSheet(transform, primitive.center);
        const r = primitive.radius * transform.factor;
        const sweep = (((primitive.end_angle - primitive.start_angle) % 360) + 360) % 360 || 360;
        const startRad = (primitive.start_angle * Math.PI) / 180;
        ops.push(`${mm(cx + r * Math.cos(startRad))} ${mm(cy + r * Math.sin(startRad))} m ${arcCurves([cx, cy], r, primitive.start_angle, sweep).join(' ')} S`);
      }
    }
  }
  return ops;
}

function sheetContent(input: SheetInput): string {
  const { model, layout } = input;
  const paper = layout === MODEL_LAYOUT ? null : model.layouts.find((entry) => entry.name === layout);
  const scale = layout === MODEL_LAYOUT ? null : paper?.viewport_scale ?? DEFAULT_VIEWPORT_SCALE;
  const transform = viewportTransform(drawingExtents(model.objects, model.layers), scale);
  const black = colorOps([0, 0, 0], true);

  const ops = [
    `q\n${trimmed(POINTS_PER_MM, 6)} 0 0 ${trimmed(POINTS_PER_MM, 6)} 0 0 cm`,
    `${black}\n${colorOps([0, 0, 0], false)}\n[] 0 d`,
    `${mm(BORDER_WEIGHT_MM)} w\n${rect(BORDER)} S\n${rect(TITLE_BLOCK)} S`,
    `${mm(FRAME_WEIGHT_MM)} w\n${rect(VIEWPORT_FRAME)} S`,
  ];
  for (const line of titleBlockText({ title: input.title, scale, issued: input.issued, revision: input.revision, note: input.note })) {
    ops.push(`BT\n/F1 ${mm(line.size)} Tf\n${mm(line.x)} ${mm(line.y)} Td\n${pdfString(line.text)} Tj\nET`);
  }
  ops.push(`q\n${rect(VIEWPORT_FRAME)} W n`, ...viewportContent(input, transform), 'Q', 'Q');
  return `${ops.join('\n')}\n`;
}

export function renderSheet(input: SheetInput): Buffer {
  const stream = deflateSync(Buffer.from(sheetContent(input), 'latin1'), { level: 9 });
  const width = (SHEET.width * POINTS_PER_MM).toFixed(2);
  const height = (SHEET.height * POINTS_PER_MM).toFixed(2);
  const bodies: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`, 'latin1'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'),
  ];

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  bodies.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(object);
    length += object.length;
  });
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(
    `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    'latin1',
  ));
  return Buffer.concat(parts);
}
