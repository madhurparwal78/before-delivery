// A small PDF writer: Helvetica text pages with real, extractable text (WinAnsi encoding).

export interface Line {
  text: string;
  bold?: boolean;
  size?: number;
  gap?: number;
}

const WIN_ANSI: Record<string, number> = { "—": 0x97, "–": 0x96, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "•": 0x95, "€": 0x80, "−": 0x2d };

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI[char] ?? char.codePointAt(0) ?? 0x3f;
    const byte = code > 0xff || (code >= 0x80 && code <= 0x9f && WIN_ANSI[char] === undefined) ? 0x3f : code;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

const PAGE_HEIGHT = 792;
const TOP = 742;
const BOTTOM = 60;

export function renderPdf(lines: Line[]): Buffer {
  const pages: string[] = [];
  let y = TOP;
  let ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 10;
    const step = size * 1.45 + (line.gap ?? 0);
    if (y - step < BOTTOM) {
      pages.push(ops.join("\n"));
      ops = [];
      y = TOP;
    }
    y -= step;
    ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf 56 ${y.toFixed(1)} Td (${encode(line.text)}) Tj ET`);
  }
  pages.push(ops.join("\n"));

  const objects: string[] = [];
  const fontRegular = 3;
  const fontBold = 4;
  const firstPage = 5;
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[fontRegular] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[fontBold] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const pageId = firstPage + i * 2;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
