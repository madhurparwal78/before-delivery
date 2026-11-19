// A minimal text-only PDF writer (Helvetica, WinAnsi) for visit-log snapshots.

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LEADING = 15;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);

export interface PdfLine {
  text: string;
  size: 10 | 14;
}

/** WinAnsi bytes for the characters the log uses; anything else becomes "?". */
const WIN_ANSI: Record<string, number> = { "—": 0x97, "–": 0x96, "·": 0xb7 };

function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI[char] ?? char.charCodeAt(0);
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 0x20 && code < 0x7f) out += String.fromCharCode(code);
    else if (code <= 0xff) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return `(${out})`;
}

export function renderPdf(lines: PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (pages.length === 0) pages.push([]);
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("");
  const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const ops = ["BT", `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`];
    for (const [i, line] of page.entries()) {
      if (i > 0) ops.push(`0 -${LEADING} Td`);
      ops.push(`/F1 ${line.size} Tf`, `${pdfString(line.text)} Tj`);
    }
    ops.push("ET");
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Splits a long line on spaces so it stays inside the page margins. */
export function wrap(text: string, size: PdfLine["size"], width = size === 14 ? 60 : 90): PdfLine[] {
  const out: PdfLine[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      out.push({ text: line, size });
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  out.push({ text: line, size });
  return out;
}
