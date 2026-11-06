// A plain one-font PDF writer for sanitation logs and the seed documents.

const LINES_PER_PAGE = 52;

function encode(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "–") out += "\\226";
    else if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else {
      const code = ch.codePointAt(0)!;
      out += code >= 0x20 && code <= 0xff ? (code < 0x7f ? ch : `\\${code.toString(8)}`) : "?";
    }
  }
  return out;
}

/** Lines of text set in Helvetica, paginated; the first line of the document is a heading. */
export function pdfDocument(lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((page, p) => {
    const body = page
      .map((line, i) => (p === 0 && i === 0 ? `/F1 14 Tf (${encode(line)}) Tj T* /F1 10 Tf` : `(${encode(line)}) Tj T*`))
      .join("\n");
    const stream = `BT /F1 10 Tf 14 TL 48 794 Td\n${body}\nET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[p]! + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
