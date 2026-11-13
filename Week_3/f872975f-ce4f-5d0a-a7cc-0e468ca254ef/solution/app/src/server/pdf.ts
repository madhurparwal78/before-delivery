// The cut ticket PDF: plain extractable text in Helvetica, no metadata dictionary.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const LEADING = 15;

export interface TicketLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number;
}

/** WinAnsi string literal; characters outside Latin-1 become `?`. */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = code === 0x2013 ? 0x96 : code === 0x2014 ? 0x97 : code < 256 ? code : 63;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
}

export function renderPdf(lines: TicketLine[]): Buffer {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= (line.gap ?? 0) + Math.max(LEADING, size + 4);
    if (y < MARGIN) {
      pages.push(ops.join("\n"));
      ops = [];
      y = PAGE_H - MARGIN - Math.max(LEADING, size + 4);
    }
    ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf ${MARGIN} ${y} Td ${literal(line.text)} Tj ET`);
  }
  pages.push(ops.join("\n"));

  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
