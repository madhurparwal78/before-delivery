/**
 * A small text-only PDF writer, used for monthly statements and for the sample
 * scans the seed writes to storage.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const LINE_HEIGHT = 15;
export const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);

export interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

/** PDF base-14 fonts use WinAnsi, so a few typographic characters are folded. */
function toWinAnsi(text: string): string {
  return text
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00d7/g, 'x')
    .replace(/[^\u0000-\u00ff]/g, '?');
}

function contentStream(lines: readonly PdfLine[]): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 10;
    parts.push(`/${line.bold ? 'F2' : 'F1'} ${size} Tf`);
    parts.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
    parts.push(`(${escapeText(toWinAnsi(line.text))}) Tj`);
    y -= LINE_HEIGHT;
  }
  parts.push('ET');
  return parts.join('\n');
}

/** Builds a PDF whose pages each hold the given lines. */
export function renderTextPdf(pages: readonly PdfLine[][]): Buffer {
  const objects: string[] = [];
  const pageCount = Math.max(1, pages.length);
  const pageObjectIds: number[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectIds.push(4 + index * 2);
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] >>`;
  objects[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const stream = contentStream(pages[index] ?? []);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 ${3 + pageCount * 2 + 1} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  }
  const boldId = 3 + pageCount * 2 + 1;
  objects[boldId] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (object === undefined) continue;
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const highest = objects.length;
  let xref = `xref\n0 ${highest}\n0000000000 65535 f \n`;
  for (let id = 1; id < highest; id += 1) {
    const offset = offsets[id] ?? 0;
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size ${highest} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Splits a long run of lines into pages. */
export function paginate(lines: readonly PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  return pages.length === 0 ? [[]] : pages;
}
