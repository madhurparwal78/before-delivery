export interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const LEADING = 16;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LEADING);

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');
}

function pageContent(lines: PdfLine[]): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const font = line.bold ? '/F2' : '/F1';
    const size = line.size ?? 10;
    parts.push(`${font} ${size} Tf`, `1 0 0 1 ${MARGIN} ${y} Tm`, `(${escapeText(line.text)}) Tj`);
    y -= LEADING;
  }
  parts.push('ET');
  return parts.join('\n');
}

export function renderPdf(lines: PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  for (let index = 0; index < Math.max(lines.length, 1); index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, index) => {
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    const content = pageContent(pageLines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const body = objects[id];
    if (body === undefined) continue;
    offsets[id] = offset;
    const chunk = Buffer.from(`${id} 0 obj\n${body}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    offset += chunk.length;
  }

  const count = objects.length;
  const xrefRows = ['0000000000 65535 f \n'];
  for (let id = 1; id < count; id += 1) {
    const at = offsets[id] ?? 0;
    xrefRows.push(`${String(at).padStart(10, '0')} 00000 n \n`);
  }
  const xref = `xref\n0 ${count}\n${xrefRows.join('')}`;
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}
