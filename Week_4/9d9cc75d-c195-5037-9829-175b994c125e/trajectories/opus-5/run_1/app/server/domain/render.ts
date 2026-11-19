import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PNG } from 'pngjs';
import { categoricalColor, CATEGORICAL_COLORS, sequentialColor, tickScale } from '../../shared/chart.js';
import { csvNumber, displayNumber, displayValue } from '../../shared/display.js';
import { isShareColumn, trendText } from '../../shared/twin.js';
import type { FilterSpec, QueryResult } from '../../shared/types.js';
import { measureCaption } from '../../shared/chart.js';
import type { QueryOutput } from './query.js';

export interface RenderView {
  name: string;
  result: QueryResult;
  output: QueryOutput;
}

export function filterLines(filters: FilterSpec[]): string[] {
  if (filters.length === 0) return ['Filters: none'];
  return filters.map((f) => {
    if (f.step === 'top') {
      const by = f.by === null || f.by === undefined ? '' : measureCaption(f.by);
      const n = typeof f.n === 'string' ? f.n.replace('@', '') : String(f.n ?? '');
      return `Filters: ${f.field} is top ${n} by ${by}`;
    }
    if (f.step === 'measure' || f.step === 'table_calc') {
      const min = f.min ?? null;
      const max = f.max ?? null;
      if (min !== null && max !== null) return `Filters: ${f.field} is ${displayNumber(min)} to ${displayNumber(max)}`;
      if (min !== null) return `Filters: ${f.field} is at least ${displayNumber(min)}`;
      if (max !== null) return `Filters: ${f.field} is at most ${displayNumber(max)}`;
      return `Filters: ${f.field} is any`;
    }
    const values = (f.values ?? []).map((v) => displayValue(v as string | number | boolean | null)).join(', ');
    return `Filters: ${f.field} is ${values}`;
  });
}

function twinLines(view: RenderView): string[] {
  const lines: string[] = [];
  const shares = view.result.columns.map((c) => c.role === 'measure' && isShareColumn(c.name));
  lines.push(view.result.columns.map((c) => c.name).join(' | '));
  for (const row of view.result.rows) {
    lines.push(
      row
        .map((v, i) => (typeof v === 'number' ? (shares[i] ? displayValue(v, true) : displayNumber(v)) : displayValue(v)))
        .join(' | '),
    );
  }
  const dimensionCount = view.result.columns.filter((c) => c.role === 'dimension').length;
  if (view.result.total !== null) {
    const cells = view.result.total.map((v, i) => {
      if (i === 0) return 'Grand total';
      if (i < dimensionCount) return '';
      if (v === 'n/a') return 'n/a';
      return typeof v === 'number' ? (shares[i] ? displayValue(v, true) : displayNumber(v)) : displayValue(v);
    });
    lines.push(cells.join(' | '));
  }
  for (const line of view.result.reference_lines) {
    lines.push(`${line.type} | ${line.value === null ? '(null)' : displayNumber(line.value)}`);
  }
  if (view.result.trend !== null) {
    lines.push(`Trend | ${trendText(view.result.trend.slope, view.result.trend.intercept)}`);
  }
  return lines;
}

export async function renderPdf(targetName: string, filters: FilterSpec[], views: RenderView[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10;
  const margin = 40;
  const lineHeight = 14;
  let page = doc.addPage([595, 842]);
  let y = page.getHeight() - margin;
  const write = (text: string): void => {
    if (y < margin) {
      page = doc.addPage([595, 842]);
      y = page.getHeight() - margin;
    }
    const clean = [...text].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127).join('');
    page.drawText(clean, { x: margin, y, size, font });
    y -= lineHeight;
  };
  write(targetName);
  filterLines(filters).forEach(write);
  for (const view of views) {
    write(view.name);
    twinLines(view).forEach(write);
  }
  return doc.save();
}

interface Canvas {
  png: PNG;
  width: number;
  height: number;
}

function fillRect(c: Canvas, x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w));
  const y1 = Math.min(c.height, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const idx = (c.width * py + px) << 2;
      c.png.data[idx] = rgb[0];
      c.png.data[idx + 1] = rgb[1];
      c.png.data[idx + 2] = rgb[2];
      c.png.data[idx + 3] = 255;
    }
  }
}

function parseTriple(text: string): [number, number, number] {
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return CATEGORICAL_COLORS[0];
  return [parts[0], parts[1], parts[2]];
}

const PLUM: [number, number, number] = [26, 10, 20];
const BLUSH: [number, number, number] = [253, 241, 247];

export function renderPng(views: RenderView[]): Buffer {
  const width = 1200;
  const height = 800;
  const png = new PNG({ width, height });
  const canvas: Canvas = { png, width, height };
  fillRect(canvas, 0, 0, width, height, [255, 255, 255]);

  const count = Math.max(1, views.length);
  const blockHeight = Math.floor(height / count);
  views.forEach((view, index) => {
    const top = index * blockHeight;
    const plot = { x: 80, y: top + 40, w: width - 160, h: blockHeight - 100 };
    fillRect(canvas, plot.x, plot.y, plot.w, plot.h, BLUSH);
    const primary = view.output.primary;
    if (primary < 0) return;
    const values = view.output.marks.map((m) =>
      typeof m.measures[primary] === 'number' ? (m.measures[primary] as number) : null,
    );
    const scale = tickScale(values);
    const span = scale.last - scale.first;
    const marks = view.output.marks.length;
    if (marks === 0) return;
    const colorIsMeasure = view.output.measures.some((m) => m.shelf === 'color');
    const present = values.filter((v): v is number => v !== null);
    const min = present.length > 0 ? Math.min(...present) : 0;
    const max = present.length > 0 ? Math.max(...present) : 0;
    const band = plot.w / marks;
    values.forEach((v, i) => {
      const rgb = colorIsMeasure
        ? parseTriple(sequentialColor(v, min, max) === '' ? '0, 0, 0' : sequentialColor(v, min, max))
        : parseTriple(categoricalColor(i));
      if (v === null) return;
      const length = span === 0 ? 0 : ((v - scale.first) / span) * plot.h;
      const barWidth = Math.max(2, band * 0.6);
      const x = plot.x + band * i + (band - barWidth) / 2;
      const y = plot.y + plot.h - length;
      fillRect(canvas, x, y, barWidth, length, rgb);
      fillRect(canvas, x, y, barWidth, 1, PLUM);
    });
    fillRect(canvas, plot.x, plot.y + plot.h, plot.w, 2, PLUM);
    fillRect(canvas, plot.x, plot.y, 2, plot.h, PLUM);
  });
  return PNG.sync.write(png);
}

function csvField(text: string, isNumber: boolean): string {
  let value = text;
  if (!isNumber && /^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  if (/[",\r\n]/.test(value)) value = `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRows(view: RenderView): string[] {
  const lines: string[] = [];
  const shares = view.result.columns.map((c) => c.role === 'measure' && isShareColumn(c.name));
  lines.push(view.result.columns.map((c) => csvField(c.name, false)).join(','));
  for (const row of view.result.rows) {
    lines.push(
      row
        .map((v, i) =>
          typeof v === 'number'
            ? csvField(csvNumber(v, shares[i]), true)
            : csvField(displayValue(v), false),
        )
        .join(','),
    );
  }
  const dimensionCount = view.result.columns.filter((c) => c.role === 'dimension').length;
  if (view.result.total !== null) {
    lines.push(
      view.result.total
        .map((v, i) => {
          if (i === 0) return csvField('Grand total', false);
          if (i < dimensionCount) return '';
          if (v === 'n/a') return csvField('n/a', false);
          return typeof v === 'number' ? csvField(csvNumber(v, shares[i]), true) : csvField(displayValue(v), false);
        })
        .join(','),
    );
  }
  for (const line of view.result.reference_lines) {
    lines.push(
      [csvField(line.type, false), line.value === null ? '' : csvField(csvNumber(line.value), true)].join(','),
    );
  }
  if (view.result.trend !== null) {
    lines.push([csvField('Trend', false), csvField(trendText(view.result.trend.slope, view.result.trend.intercept), false)].join(','));
  }
  return lines;
}

export function renderCsv(views: RenderView[]): Buffer {
  const blocks = views.map((view) => (views.length > 1 ? [csvField(view.name, false), ...csvRows(view)] : csvRows(view)));
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) lines.push('');
    lines.push(...block);
  });
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}
