// A small text-only PDF writer (Helvetica, US Letter) for statements and the seeded scans.

interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space before the line, in points. */
  gap?: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;

const SUBSTITUTES: Record<string, string> = { "−": "-", "–": "-", "—": "-", "×": "x", "…": "...", "·": "-" };

function pdfText(value: string): string {
  const plain = [...value].map((c) => SUBSTITUTES[c] ?? (c.charCodeAt(0) < 128 ? c : "?")).join("");
  return plain.replace(/[\\()]/g, (c) => `\\${c}`);
}

function paginate(lines: readonly PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const step = (line.size ?? 10) * 1.45 + (line.gap ?? 0);
    if (y - step < MARGIN) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= step;
    pages[pages.length - 1]?.push(line);
  }
  return pages;
}

function contentStream(lines: readonly PdfLine[]): string {
  let y = PAGE_HEIGHT - MARGIN;
  const ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 10;
    y -= size * 1.45 + (line.gap ?? 0);
    ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${pdfText(line.text)}) Tj ET`);
  }
  return ops.join("\n");
}

export function renderPdf(lines: readonly PdfLine[]): Buffer {
  const pages = paginate(lines);
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, index) => {
    const pageId = pageIds[index] ?? 0;
    const stream = contentStream(page);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id] ?? ""}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
