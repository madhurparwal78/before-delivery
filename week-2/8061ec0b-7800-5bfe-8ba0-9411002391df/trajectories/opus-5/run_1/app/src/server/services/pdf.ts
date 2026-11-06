const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LINES_PER_PAGE = 52;
const LEADING = 14;

function parenthesesBalanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Keeps balanced parentheses literal, so every printed value reads as plain text in the file. */
function pdfString(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\');
  return parenthesesBalanced(escaped) ? escaped : escaped.replace(/[()]/g, (char) => `\\${char}`);
}

function contentStream(lines: string[]): string {
  const body = lines
    .map((line, index) => (index === 0 ? `(${pdfString(line)}) Tj` : `T* (${pdfString(line)}) Tj`))
    .join('\n');
  return `BT\n/F1 11 Tf\n${LEADING} TL\n1 0 0 1 56 ${PAGE_HEIGHT - 64} Tm\n${body}\nET\n`;
}

/** A plain uncompressed PDF, so every value it prints is searchable in the stored bytes. */
export function buildPdf(lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['']);

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  pages.forEach((pageLines, index) => {
    const contentId = pageObjectIds[index]! + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = contentStream(pageLines);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  });

  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(file, 'latin1'));
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(file, 'latin1');
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(file, 'latin1');
}
