// A small text PDF writer (Helvetica, WinAnsi encoding): real extractable text, one or more A4 pages.

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space above the line in points. */
  gap?: number;
  indent?: number;
}

const WIN_ANSI_EXTRA: Record<string, number> = { "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "€": 0x80 };

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI_EXTRA[char] ?? char.codePointAt(0) ?? 63;
    const byte = code <= 0xff ? code : 63;
    const ch = String.fromCharCode(byte);
    out += ch === "(" || ch === ")" || ch === "\\" ? `\\${ch}` : ch;
  }
  return out;
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 10;
    const step = size * 1.4 + (line.gap ?? 0);
    if (y - step < MARGIN) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= step;
    pages[pages.length - 1]?.push(line);
  }
  return pages;
}

function contentStream(lines: PdfLine[]): string {
  let y = PAGE_HEIGHT - MARGIN;
  const ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 10;
    y -= size * 1.4 + (line.gap ?? 0);
    ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf ${MARGIN + (line.indent ?? 0)} ${y.toFixed(1)} Td (${encode(line.text)}) Tj ET`);
  }
  return ops.join("\n");
}

export function buildPdf(title: string, lines: PdfLine[]): Buffer {
  const pages = paginate(lines);
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index] ?? 0;
    const stream = contentStream(pageLines);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  const infoId = objects.length;
  objects[infoId] = `<< /Title (${encode(title)}) /Producer (Passboard) >>`;
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
