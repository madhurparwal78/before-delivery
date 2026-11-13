/**
 * A minimal PDF writer for the sealed records. Produces a valid PDF with
 * Helvetica text pages and no dependency.
 */

export interface PdfLine {
  text: string;
  bold?: boolean;
}

/** Paginate lines onto A4 pages, 16 points apart, new page under 60pt. */
export function paginate(lines: PdfLine[]): { pages: PdfLine[][] } {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = 780;
  for (const line of lines) {
    if (y < 60) {
      pages.push(current);
      current = [];
      y = 780;
    }
    current.push(line);
    y -= 16;
  }
  if (current.length > 0) pages.push(current);
  return { pages };
}

export function buildPdf(pages: PdfLine[][]): Buffer {
  const objects: { id: number; body: string }[] = [];
  const HELVETICA_ID = 3;
  const HELVETICA_BOLD_ID = 4;
  let nextId = 5;
  const pageObjectIds: number[] = [];
  const contentStreams: { id: number; stream: string }[] = [];
  for (const page of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    pageObjectIds.push(pageId);
    const parts: string[] = [];
    let y = 800;
    for (const line of page) {
      parts.push(`BT /${line.bold ? "F2" : "F1"} 10 Tf 48 ${y} Td (${escapePdf(line.text)}) Tj ET`);
      y -= 16;
    }
    const stream = parts.join("\n");
    contentStreams.push({ id: contentId, stream });
    objects.push({ id: pageId, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${HELVETICA_ID} 0 R /F2 ${HELVETICA_BOLD_ID} 0 R >> >> /Contents ${contentId} 0 R >>` });
  }
  for (const content of contentStreams) {
    objects.push({ id: content.id, body: `<< /Length ${content.stream.length} >>\nstream\n${content.stream}\nendstream` });
  }
  objects.push({ id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" });
  objects.push({ id: 2, body: `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>` });
  objects.push({ id: HELVETICA_ID, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });
  objects.push({ id: HELVETICA_BOLD_ID, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>" });
  objects.sort((a, b) => a.id - b.id);

  const chunks: Buffer[] = [];
  const offsets = new Map<number, number>();
  let position = 0;
  const push = (text: string): void => {
    const buffer = Buffer.from(text, "latin1");
    chunks.push(buffer);
    position += buffer.length;
  };
  push("%PDF-1.4\n");
  for (const object of objects) {
    offsets.set(object.id, position);
    push(`${object.id} 0 obj\n${object.body}\nendobj\n`);
  }
  const xrefStart = position;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) {
    push(`${String(offsets.get(i)).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

function escapePdf(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, "?").replace(/([()\\])/g, "\\$1");
}
