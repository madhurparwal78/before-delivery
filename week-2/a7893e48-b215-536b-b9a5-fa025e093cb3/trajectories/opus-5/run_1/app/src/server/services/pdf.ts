const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 42;
const LEADING = 14;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LEADING);

export interface PdfLine {
  text: string;
  bold?: boolean;
}

function escapeText(text: string): string {
  return text
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function contentStream(lines: readonly PdfLine[]): string {
  const parts = ['BT', `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`, `${LEADING} TL`];
  for (const line of lines) {
    parts.push(`/${line.bold === true ? 'F2' : 'F1'} ${line.bold === true ? 11 : 9.5} Tf`);
    parts.push(`(${escapeText(line.text)}) Tj T*`);
  }
  parts.push('ET');
  return parts.join('\n');
}

/** A plain Helvetica document; enough for the compliance binder. */
export function buildPdf(lines: readonly PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((pageLines, index) => {
    const contentId = pageObjectIds[index] as number;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId + 1} 0 R >>`,
    );
    const stream = contentStream(pageLines);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
