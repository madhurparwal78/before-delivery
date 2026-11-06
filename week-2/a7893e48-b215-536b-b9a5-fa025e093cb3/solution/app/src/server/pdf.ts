/** A minimal text-only PDF writer: Helvetica in WinAnsi, A4 portrait, automatic page breaks. */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number;
}

const WIN_ANSI: Record<string, number> = { "—": 0x97, "–": 0x96, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "·": 0xb7, "…": 0x85 };

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI[char] ?? char.charCodeAt(0);
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 32 || code > 255) out += "?";
    else if (code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += char;
  }
  return out;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

export function renderPdf(lines: PdfLine[]): Buffer {
  const pages: string[] = [];
  let content = "";
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 10;
    const advance = size * 1.4 + (line.gap ?? 0);
    if (y - advance < MARGIN) {
      pages.push(content);
      content = "";
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= advance;
    content += `BT /${line.bold ? "F2" : "F1"} ${size} Tf ${MARGIN} ${y.toFixed(1)} Td (${encode(line.text)}) Tj ET\n`;
  }
  pages.push(content);

  const objects: string[] = [];
  const pageIds = pages.map((_page, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((stream, index) => {
    const pageId = pageIds[index] ?? 0;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id] ?? "null"}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
