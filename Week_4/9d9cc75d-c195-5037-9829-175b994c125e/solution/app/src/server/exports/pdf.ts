// The PDF: real text lines, in the order the brief gives them, set in the bundled Stack Sans Text.
import { PDFDocument } from '@napi-rs/canvas';

type PageContext = ReturnType<PDFDocument['beginPage']>;
import { formatCell, formatNumber, measureCaption } from '../../shared/display.ts';
import type { Filter, ParameterValue } from '../../shared/model.ts';
import { buildTwin } from '../../shared/twin.ts';
import type { ExportDocument } from './document.ts';
import { FAMILY, registerFonts } from './png.ts';

interface PdfLine {
  text: string;
  /** names (the export's and each sheet's) are set heavier than the rest */
  heading: boolean;
}

function topCount(n: number | string, parameters: Record<string, ParameterValue>): string {
  if (typeof n === 'number') return formatNumber(n);
  const value = parameters[n.slice(1)];
  return typeof value === 'number' ? formatNumber(value) : String(value ?? n);
}

/** The `Filters:` line of one filter. */
export function filterLine(filter: Filter, parameters: Record<string, ParameterValue>): string {
  if (filter.n !== null && filter.by) return `Filters: ${filter.field} is top ${topCount(filter.n, parameters)} by ${measureCaption(filter.by)}`;
  if (filter.min !== null && filter.max !== null) {
    return `Filters: ${filter.field} is ${formatNumber(filter.min)} to ${formatNumber(filter.max)}`;
  }
  if (filter.min !== null) return `Filters: ${filter.field} is at least ${formatNumber(filter.min)}`;
  if (filter.max !== null) return `Filters: ${filter.field} is at most ${formatNumber(filter.max)}`;
  return `Filters: ${filter.field} is ${filter.values.map((value) => formatCell(value)).join(', ')}`;
}

/** A cell with a line break or tab would split a row across lines. */
const oneLine = (text: string): string => text.replace(/[\r\n\t]/g, ' ');

export function pdfLines(document: ExportDocument): PdfLine[] {
  const filters = document.filters.map((filter) => filterLine(filter, document.parameters));
  const lines: PdfLine[] = [{ text: document.name, heading: true }];
  for (const text of filters.length > 0 ? filters : ['Filters: none']) lines.push({ text, heading: false });
  for (const block of document.blocks) {
    const twin = buildTwin(block.result);
    lines.push({ text: block.name, heading: true });
    lines.push({ text: [...twin.dimensions, ...twin.measures].join(' | '), heading: false });
    for (const row of twin.rows) {
      lines.push({ text: [...row.heads, ...row.cells.map((cell) => cell.text)].join(' | '), heading: false });
    }
  }
  return lines.map((line) => ({ ...line, text: oneLine(line.text) }));
}

const BODY_SIZE = 11;
const HEADING_SIZE = 15;
const PAGE = { width: 612, height: 792, margin: 48 };

/** Splits one line into pieces that fit the text width, breaking at spaces where it can. */
function wrap(ctx: PageContext, text: string, width: number): string[] {
  const fits = (piece: string): boolean => ctx.measureText(piece).width <= width;
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current === '' ? word : `${current} ${word}`;
    if (fits(next)) {
      current = next;
      continue;
    }
    if (current !== '') pieces.push(current);
    current = word;
    while (!fits(current) && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && !fits(current.slice(0, cut))) cut -= 1;
      pieces.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  pieces.push(current);
  return pieces;
}

export function renderPdf(document: ExportDocument, fontDir: string): Buffer {
  registerFonts(fontDir);
  const pdf = new PDFDocument({ title: document.name });
  const width = PAGE.width - 2 * PAGE.margin;
  const newPage = (): PageContext => {
    const page = pdf.beginPage(PAGE.width, PAGE.height);
    page.fillStyle = '#000000';
    page.textBaseline = 'alphabetic';
    return page;
  };
  let ctx = newPage();
  let y = PAGE.margin;
  for (const line of pdfLines(document)) {
    const size = line.heading ? HEADING_SIZE : BODY_SIZE;
    const leading = size * 1.35;
    ctx.font = `${line.heading ? 600 : 400} ${size}px "${FAMILY}"`;
    for (const piece of wrap(ctx, line.text, width)) {
      if (y + leading > PAGE.height - PAGE.margin) {
        pdf.endPage();
        ctx = newPage();
        ctx.font = `${line.heading ? 600 : 400} ${size}px "${FAMILY}"`;
        y = PAGE.margin;
      }
      y += leading;
      ctx.fillText(piece, PAGE.margin, y);
    }
    if (line.heading) y += 4;
  }
  pdf.endPage();
  return pdf.close();
}
