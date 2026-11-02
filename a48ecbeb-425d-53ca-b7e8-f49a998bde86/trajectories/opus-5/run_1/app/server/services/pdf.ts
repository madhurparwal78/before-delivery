export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space, in points, left above this line. */
  gap?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const DEFAULT_SIZE = 11;

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');
}

/**
 * Writes a single-page PDF of left-aligned text lines using the two standard
 * Helvetica faces, so no font file or PDF library ships with the app.
 */
export function renderTextPdf(lines: readonly PdfLine[]): Buffer {
  let cursor = PAGE_HEIGHT - MARGIN;
  const operations: string[] = [];
  for (const line of lines) {
    const size = line.size ?? DEFAULT_SIZE;
    cursor -= (line.gap ?? 0) + size * 1.45;
    operations.push(
      `BT /${line.bold === true ? 'F2' : 'F1'} ${size} Tf ${MARGIN} ${cursor.toFixed(2)} Td (${escapeText(line.text)}) Tj ET`,
    );
  }
  const content = operations.join('\n');
  const contentBytes = Buffer.from(content, 'latin1');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentBytes.byteLength} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
