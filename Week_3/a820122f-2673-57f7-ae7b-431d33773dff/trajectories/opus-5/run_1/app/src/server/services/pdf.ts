const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const LINE_HEIGHT = 14;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT) - 2;

function escapeText(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63;
    const safe = code < 32 || code > 255 ? '?' : character;
    if (safe === '(' || safe === ')' || safe === '\\') out += `\\${safe}`;
    else out += safe;
  }
  return out;
}

function contentStream(title: string, lines: readonly string[], pageNumber: number): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  parts.push(`/F2 14 Tf 1 0 0 1 ${MARGIN} ${y} Tm (${escapeText(title)}) Tj`);
  y -= LINE_HEIGHT * 2;
  parts.push('/F1 10 Tf');
  for (const line of lines) {
    parts.push(`1 0 0 1 ${MARGIN} ${y} Tm (${escapeText(line)}) Tj`);
    y -= LINE_HEIGHT;
  }
  parts.push(`/F1 8 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 20} Tm (Page ${pageNumber}) Tj`);
  parts.push('ET');
  return parts.join('\n');
}

/** Writes a text-only PDF document with no outside dependency. */
export function buildPdf(title: string, lines: readonly string[]): Buffer {
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(1, lines.length); index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE) as string[]);
  }

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const firstPageObject = 5;
  pages.forEach((_, index) => pageObjectNumbers.push(firstPageObject + index * 2));

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  );

  pages.forEach((pageLines, index) => {
    const contentNumber = firstPageObject + index * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    const stream = contentStream(title, pageLines, index + 1);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
