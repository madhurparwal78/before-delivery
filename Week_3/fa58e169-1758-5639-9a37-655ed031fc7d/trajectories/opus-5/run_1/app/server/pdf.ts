import { makeGrid } from '../src/domain/chart';
import { NO_STITCH, stitchText, symbolsFor } from '../src/domain/symbols';
import type { Chart } from '../src/domain/types';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const BODY_SIZE = 11;
const LINE_STEP = 15;

export interface SheetInput {
  name: string;
  version: number;
  castOn: number;
  chart: Chart;
  lines: string[];
  linesPerPage: number;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(value: string, size: number): number {
  return value.length * size * 0.52;
}

function wrap(value: string, size: number, maxWidth: number): string[] {
  if (textWidth(value, size) <= maxWidth) return [value];
  const words = value.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (textWidth(candidate, size) > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

class Page {
  private readonly parts: string[] = [];

  text(value: string, x: number, y: number, size: number, bold = false): void {
    this.parts.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(value)}) Tj ET`,
    );
  }

  rect(x: number, y: number, width: number, height: number, fill: [number, number, number] | null): void {
    if (fill) {
      this.parts.push(
        `${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
      );
    }
    this.parts.push(
      `0.55 0.6 0.7 RG 0.4 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`,
    );
  }

  stream(): string {
    return this.parts.join('\n');
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return [Number.isFinite(r) ? r : 1, Number.isFinite(g) ? g : 1, Number.isFinite(b) ? b : 1];
}

function keyLines(chart: Chart): string[] {
  const used = new Set(chart.cells.map((cell) => cell.stitch));
  const lines: string[] = [];
  for (const symbol of symbolsFor(chart.craft)) {
    if (symbol.key === NO_STITCH || !used.has(symbol.key)) continue;
    lines.push(`${stitchText(symbol, chart.craft, chart.terms, 'RS')} ${symbol.name}`);
  }
  return lines;
}

function drawChart(page: Page, chart: Chart, top: number, bottom: number): void {
  const available = PAGE_WIDTH - 2 * MARGIN;
  const height = top - bottom;
  const size = Math.min(available / chart.width, height / chart.height, 16);
  const grid = makeGrid(chart);
  const originX = MARGIN;
  const originY = bottom + Math.max(0, height - size * chart.height);
  for (let row = 1; row <= chart.height; row += 1) {
    for (let col = 1; col <= chart.width; col += 1) {
      const cell = grid(row, col);
      const x = originX + (col - 1) * size;
      const y = originY + (row - 1) * size;
      const colour = chart.colours.find((entry) => entry.letter === cell.colour);
      const fill = cell.stitch === NO_STITCH ? null : hexToRgb(colour?.hex ?? '#ffffff');
      page.rect(x, y, size, size, fill);
      if (cell.stitch === NO_STITCH) continue;
      const symbol = symbolsFor(chart.craft).find((entry) => entry.key === cell.stitch);
      if (!symbol) continue;
      const label = stitchText(symbol, chart.craft, chart.terms, 'RS');
      const fontSize = Math.max(3, Math.min(size * 0.5, 8));
      page.text(
        label,
        x + size / 2 - textWidth(label, fontSize) / 2,
        y + size / 2 - fontSize * 0.35,
        fontSize,
      );
    }
  }
}

export function buildSheet(input: SheetInput): Buffer {
  const pages: Page[] = [];
  const first = new Page();
  pages.push(first);

  let y = PAGE_HEIGHT - MARGIN - 14;
  first.text(input.name, MARGIN, y, 20, true);
  y -= 26;
  first.text(`Version ${input.version}`, MARGIN, y, BODY_SIZE);
  y -= LINE_STEP;
  first.text(
    input.castOn === 1 ? 'Cast on 1 stitch' : `Cast on ${input.castOn} stitches`,
    MARGIN,
    y,
    BODY_SIZE,
  );
  y -= 26;
  first.text('Chart', MARGIN, y, 14, true);
  y -= 12;

  const key = keyLines(input.chart);
  const keyBlockHeight = 26 + key.length * LINE_STEP;
  const chartBottom = MARGIN + 24 + keyBlockHeight;
  drawChart(first, input.chart, y, chartBottom);

  let keyY = MARGIN + 24 + keyBlockHeight - 14;
  first.text('Key', MARGIN, keyY, 14, true);
  keyY -= 20;
  for (const line of key) {
    first.text(line, MARGIN, keyY, BODY_SIZE);
    keyY -= LINE_STEP;
  }

  for (let start = 0; start < input.lines.length; start += input.linesPerPage) {
    const page = new Page();
    pages.push(page);
    let lineY = PAGE_HEIGHT - MARGIN - 14;
    page.text('Instructions', MARGIN, lineY, 14, true);
    lineY -= 24;
    for (const line of input.lines.slice(start, start + input.linesPerPage)) {
      for (const part of wrap(line, BODY_SIZE, PAGE_WIDTH - 2 * MARGIN)) {
        page.text(part, MARGIN, lineY, BODY_SIZE);
        lineY -= LINE_STEP;
      }
    }
  }

  pages.forEach((page, index) => {
    page.text(`${input.name} - page ${index + 1} of ${pages.length}`, MARGIN, MARGIN - 20, 9);
  });

  return assemble(pages);
}

function assemble(pages: Page[]): Buffer {
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const stream = page.stream();
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const body = objects[id];
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
