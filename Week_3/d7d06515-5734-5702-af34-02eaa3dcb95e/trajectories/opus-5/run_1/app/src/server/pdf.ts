import type { ColorName, PlotStyle, Point } from '../shared/api';
import type { Units } from '../shared/format';
import type { LayerRecord } from './drawings';
import type { Extents } from './geometry';
import type { StoredObject } from './model';
import { flattenCurve, renderObject } from './render';

const MM_TO_POINT = 72 / 25.4;
export const SHEET_WIDTH_MM = 420;
export const SHEET_HEIGHT_MM = 297;
const MARGIN_MM = 10;
const TITLE_BLOCK_WIDTH_MM = 180;
const TITLE_BLOCK_HEIGHT_MM = 60;

const RGB_BY_COLOR: Record<ColorName, [number, number, number]> = {
  Red: [1, 0, 0],
  Yellow: [1, 1, 0],
  Green: [0, 1, 0],
  Cyan: [0, 1, 1],
  Blue: [0, 0, 1],
  Magenta: [1, 0, 1],
  White: [1, 1, 1],
};

const LINEWEIGHT_MM: Record<string, number> = {
  '0.13 mm': 0.13,
  '0.18 mm': 0.18,
  '0.25 mm': 0.25,
  '0.35 mm': 0.35,
  '0.50 mm': 0.5,
  '0.70 mm': 0.7,
  '1.00 mm': 1,
};

export interface PdfSheetOptions {
  title: string;
  layout: string;
  viewportScale: string | null;
  issueDate: string;
  revisionLetter: string;
  footerNote: string;
  plotStyle: PlotStyle;
  layers: LayerRecord[];
  objects: StoredObject[];
  all: Map<string, StoredObject>;
  units: Units;
  extents: Extents;
}

/** The plot style decides every printed stroke colour. */
function strokeColor(
  plotStyle: PlotStyle,
  objectColor: string,
  layerColor: string,
): [number, number, number] {
  if (plotStyle === 'Monochrome') return [0, 0, 0];
  const name = (objectColor === 'ByLayer' ? layerColor : objectColor) as ColorName;
  const rgb = RGB_BY_COLOR[name] ?? [1, 1, 1];
  if (plotStyle === 'Grayscale') {
    const lightness = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return [lightness, lightness, lightness];
  }
  if (name === 'White') return [0, 0, 0];
  return rgb;
}

function escapeText(value: string): string {
  return value.replace(/[\\()]/g, (character) => `\\${character}`).replace(/[^\x20-\x7e]/g, '?');
}

class ContentStream {
  private readonly parts: string[] = [];

  moveTo(x: number, y: number): void {
    this.parts.push(`${fixed(x)} ${fixed(y)} m`);
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`${fixed(x)} ${fixed(y)} l`);
  }

  stroke(): void {
    this.parts.push('S');
  }

  width(points: number): void {
    this.parts.push(`${fixed(points)} w`);
  }

  color(rgb: [number, number, number]): void {
    this.parts.push(`${fixed(rgb[0])} ${fixed(rgb[1])} ${fixed(rgb[2])} RG`);
  }

  text(x: number, y: number, size: number, value: string): void {
    this.parts.push(`BT /F1 ${fixed(size)} Tf ${fixed(x)} ${fixed(y)} Td (${escapeText(value)}) Tj ET`);
  }

  toString(): string {
    return this.parts.join('\n');
  }
}

function fixed(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

function viewportFactor(scale: string | null): number | null {
  if (scale === null) return null;
  const denominator = Number.parseInt(scale.split(':')[1] ?? '', 10);
  return Number.isFinite(denominator) && denominator > 0 ? 1 / denominator : null;
}

/** One A3 landscape vector page with the title block in the lower right. */
export function renderPdfSheet(options: PdfSheetOptions): Buffer {
  const stream = new ContentStream();
  const areaWidth = SHEET_WIDTH_MM - 2 * MARGIN_MM;
  const areaHeight = SHEET_HEIGHT_MM - 2 * MARGIN_MM;
  const extentsWidth = Math.max(1e-6, options.extents.max[0] - options.extents.min[0]);
  const extentsHeight = Math.max(1e-6, options.extents.max[1] - options.extents.min[1]);
  const paperFactor = viewportFactor(options.viewportScale);
  const scale = paperFactor ?? Math.min(areaWidth / extentsWidth, areaHeight / extentsHeight);
  const centreX = (options.extents.min[0] + options.extents.max[0]) / 2;
  const centreY = (options.extents.min[1] + options.extents.max[1]) / 2;

  const toPage = (point: Point): [number, number] => [
    (SHEET_WIDTH_MM / 2 + (point[0] - centreX) * scale) * MM_TO_POINT,
    (SHEET_HEIGHT_MM / 2 + (point[1] - centreY) * scale) * MM_TO_POINT,
  ];

  const layerOf = (name: string): LayerRecord | undefined =>
    options.layers.find((layer) => layer.name === name);

  for (const object of options.objects) {
    const layer = layerOf(object.layer);
    if (layer === undefined) continue;
    const rendered = renderObject(object, options.all, options.units);
    const weight = object.lineweight === 'ByLayer' ? layer.lineweight : object.lineweight;
    stream.width(Math.max(0.1, (LINEWEIGHT_MM[weight] ?? 0.25) * MM_TO_POINT));
    stream.color(strokeColor(options.plotStyle, object.color, layer.color));
    for (const curve of rendered.curves) {
      const points = flattenCurve(curve);
      const first = points[0];
      if (first === undefined) continue;
      const start = toPage(first);
      stream.moveTo(start[0], start[1]);
      for (const point of points.slice(1)) {
        const mapped = toPage(point);
        stream.lineTo(mapped[0], mapped[1]);
      }
      stream.stroke();
    }
    for (const text of rendered.texts) {
      const position = toPage(text.position);
      stream.text(position[0], position[1], Math.max(4, text.height * scale * MM_TO_POINT), text.text);
    }
  }

  stream.color([0, 0, 0]);
  stream.width(0.5 * MM_TO_POINT);
  const blockLeft = SHEET_WIDTH_MM - MARGIN_MM - TITLE_BLOCK_WIDTH_MM;
  const blockBottom = MARGIN_MM;
  const corners: Array<[number, number]> = [
    [blockLeft, blockBottom],
    [blockLeft + TITLE_BLOCK_WIDTH_MM, blockBottom],
    [blockLeft + TITLE_BLOCK_WIDTH_MM, blockBottom + TITLE_BLOCK_HEIGHT_MM],
    [blockLeft, blockBottom + TITLE_BLOCK_HEIGHT_MM],
  ];
  stream.moveTo(corners[0]![0] * MM_TO_POINT, corners[0]![1] * MM_TO_POINT);
  for (const corner of corners.slice(1)) stream.lineTo(corner[0] * MM_TO_POINT, corner[1] * MM_TO_POINT);
  stream.lineTo(corners[0]![0] * MM_TO_POINT, corners[0]![1] * MM_TO_POINT);
  stream.stroke();

  const lines = [
    `TITLE ${options.title}`,
    'SHEET A-101',
    `SCALE ${options.viewportScale ?? 'FIT'}`,
    `ISSUED ${options.issueDate}`,
    `REVISION ${options.revisionLetter}`,
    `NOTE ${options.footerNote}`,
  ];
  lines.forEach((line, index) => {
    const y = blockBottom + TITLE_BLOCK_HEIGHT_MM - 9 - index * 8.5;
    stream.text((blockLeft + 5) * MM_TO_POINT, y * MM_TO_POINT, 9, line);
  });

  return assemblePdf(stream.toString());
}

function assemblePdf(content: string): Buffer {
  const mediaBox = `[0 0 ${fixed(SHEET_WIDTH_MM * MM_TO_POINT)} ${fixed(SHEET_HEIGHT_MM * MM_TO_POINT)}]`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}
