const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const FONT_SIZE = 9;

function escapeText(text: string): string {
  return text
    .replace(/[^\x20-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function pageContent(lines: string[]): string {
  const available = PAGE_HEIGHT - 2 * MARGIN;
  const leading = Math.min(14, available / Math.max(1, lines.length));
  const size = Math.min(FONT_SIZE, leading * 0.85);
  const parts = lines.map((line, i) => {
    const y = (PAGE_HEIGHT - MARGIN - i * leading).toFixed(2);
    return `BT /F1 ${size.toFixed(2)} Tf ${MARGIN} ${y} Td (${escapeText(line)}) Tj ET`;
  });
  return parts.join('\n');
}

/** A plain PDF with one text line per entry, using the standard Helvetica font so the text is extractable. */
export function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    const stream = pageContent(lines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
