// A small PDF 1.4 writer: Letter pages, the standard Helvetica faces, text and rules only.

export interface PdfText {
  kind: "text";
  text: string;
  size: number;
  bold?: boolean;
  /** Right-aligns the text so it ends at this x. */
  right?: number;
  x: number;
}

export interface PdfRule {
  kind: "rule";
}

export interface PdfGap {
  kind: "gap";
  height: number;
}

/** A row of texts sharing one baseline. */
export interface PdfRow {
  kind: "row";
  cells: PdfText[];
}

export type PdfBlock = PdfRow | PdfRule | PdfGap;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

// Helvetica advance widths (per 1000 em) for printable ASCII, used to right-align figures.
const WIDTHS =
  "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"
    .split(",")
    .map(Number);

function width(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code < 127 ? WIDTHS[code - 32] : 556;
  }
  return (units * size * (bold ? 1.05 : 1)) / 1000;
}

/** Latin-1 bytes in a PDF literal string, with the three special characters escaped. */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = code < 256 ? code : 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `(${out})`;
}

export function renderPdf(title: string, blocks: PdfBlock[]): Buffer {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = PAGE_H - MARGIN;
  };
  for (const block of blocks) {
    if (block.kind === "gap") {
      y -= block.height;
      continue;
    }
    if (block.kind === "rule") {
      y -= 6;
      ops.push(`0.6 w 0.75 G ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
      y -= 10;
      continue;
    }
    const height = Math.max(...block.cells.map((c) => c.size)) * 1.45;
    if (y - height < MARGIN) newPage();
    y -= height;
    for (const cell of block.cells) {
      const x = cell.right !== undefined ? cell.right - width(cell.text, cell.size, cell.bold ?? false) : cell.x;
      ops.push(`BT /${cell.bold ? "F2" : "F1"} ${cell.size} Tf ${Math.round(x)} ${Math.round(y)} Td ${literal(cell.text)} Tj ET`);
    }
  }
  pages.push(ops.join("\n"));

  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("");
  const pagesId = add("");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${literal(title)} /Producer (Ceibo Shop & Cellar) >>`);
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const PDF_MARGIN = MARGIN;
export const PDF_RIGHT = PAGE_W - MARGIN;
