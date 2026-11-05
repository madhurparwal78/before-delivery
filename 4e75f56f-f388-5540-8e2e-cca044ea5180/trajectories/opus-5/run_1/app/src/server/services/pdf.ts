export interface PdfLine {
  readonly text: string;
  readonly size?: number;
  readonly bold?: boolean;
  readonly gap?: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 64;
const BOTTOM = 72;

const ASCII_SUBSTITUTES: Record<string, string> = {
  '\u2014': '-',
  '\u2013': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
};

function escapeText(value: string): string {
  return value
    .replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/g, (c) => ASCII_SUBSTITUTES[c] as string)
    .replace(/[\\()]/g, (character) => `\\${character}`);
}

function buildContent(lines: readonly PdfLine[]): string[] {
  const pages: string[] = [];
  let stream = '';
  let cursor = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 11;
    const leading = size * 1.5 + (line.gap ?? 0);
    if (cursor - leading < BOTTOM) {
      pages.push(stream);
      stream = '';
      cursor = PAGE_HEIGHT - MARGIN;
    }
    cursor -= leading;
    const font = line.bold === true ? '/F2' : '/F1';
    stream += `BT ${font} ${size} Tf 1 0 0 1 ${MARGIN} ${cursor.toFixed(2)} Tm (${escapeText(line.text)}) Tj ET\n`;
  }
  pages.push(stream);
  return pages;
}

/** A text-only PDF: every value in `lines` is extractable text. */
export function renderPdf(lines: readonly PdfLine[]): Uint8Array {
  const contentStreams = buildContent(lines);
  const pageCount = contentStreams.length;
  const fontObjects = 2;
  const firstPageObject = 3;
  const firstContentObject = firstPageObject + pageCount;
  const firstFontObject = firstContentObject + pageCount;

  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, index) => `${firstPageObject + index} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${firstFontObject} 0 R /F2 ${firstFontObject + 1} 0 R >> >> ` +
        `/Contents ${firstContentObject + index} 0 R >>`,
    );
  }
  for (const stream of contentStreams) {
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  if (objects.length !== firstFontObject + fontObjects - 1) {
    throw new Error('pdf object layout mismatch');
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
