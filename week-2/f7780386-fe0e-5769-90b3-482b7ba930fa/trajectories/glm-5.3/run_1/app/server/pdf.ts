// A minimal PDF writer: one or more pages of text in the base-14 Helvetica,
// extractable as text, stored in MinIO as the packet snapshot.

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

interface PlacedLine extends PdfLine {
  y: number;
  page: number;
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const lineHeight = 18;
  const usable = PAGE_H - MARGIN * 2;
  const perPage = Math.floor(usable / lineHeight);
  const placed: PlacedLine[] = [];
  lines.forEach((line, i) => {
    placed.push({ ...line, y: PAGE_H - MARGIN - (i % perPage) * lineHeight, page: Math.floor(i / perPage) });
  });
  const pageCount = Math.max(1, Math.ceil(lines.length / perPage));

  const objects: string[] = [];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  // 1: catalog, 2: pages, 3: font regular, 4: font bold, then per page: page + content.
  let nextId = 5;
  for (let p = 0; p < pageCount; p++) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

  for (let p = 0; p < pageCount; p++) {
    const pageLines = placed.filter((l) => l.page === p);
    const parts: string[] = [];
    for (const line of pageLines) {
      const size = line.size ?? 11;
      const font = line.bold ? '/F2' : '/F1';
      parts.push('BT', `${font} ${size} Tf`, `1 0 0 1 ${MARGIN} ${line.y} Tm`, `(${escapePdf(line.text)}) Tj`, 'ET');
    }
    objects[pageIds[p]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[p]} 0 R >>`;
    objects[contentIds[p]!] = `<< /Length ${Buffer.byteLength(parts.join('\n'), 'latin1')} >>\nstream\n${parts.join('\n')}\nendstream`;
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    const body = objects[id];
    if (!body) continue;
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  const maxId = objects.length - 1;
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    const off = offsets[id] ?? 0;
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '?');
}
