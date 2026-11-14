const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const LINE_HEIGHT = 14;
const SUMMARY_LINES_PER_PAGE = 48;
const TIMELINE_ROWS_PER_PAGE = 30;

/** Latin-1 bytes with the PDF string escapes; anything the standard fonts cannot draw becomes a question mark. */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = code < 256 ? code : 63;
    out += ch === "(" || ch === ")" || ch === "\\" ? `\\${ch}` : String.fromCharCode(byte);
  }
  return out;
}

function chunks<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length > 0 ? pages : [[]];
}

function pageContent(lines: string[], footer: string, headline: boolean): string {
  const ops: string[] = [];
  lines.forEach((line, index) => {
    const size = headline && index === 0 ? 16 : 9;
    ops.push(`BT /F1 ${size} Tf 1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN - index * LINE_HEIGHT - (size === 16 ? 2 : 0)} Tm (${pdfString(line)}) Tj ET`);
  });
  ops.push(`BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 10} Tm (${pdfString(footer)}) Tj ET`);
  return ops.join("\n");
}

/** A PDF with real text: summary pages first, then the timeline in pages of 30 rows, every page footed. */
export function pdfDocument(summary: string[], timeline: string[]): Buffer {
  const summaryPages = chunks(summary, SUMMARY_LINES_PER_PAGE);
  const timelinePages = chunks(timeline, TIMELINE_ROWS_PER_PAGE);
  const contents = [...summaryPages.map((lines, i) => ({ lines, headline: i === 0 })), ...timelinePages.map((lines) => ({ lines, headline: false }))];
  const total = contents.length;
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const firstPage = 4;
  const kids = contents.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  contents.forEach((page, i) => {
    const stream = pageContent(page.lines, `Training only - page ${i + 1} of ${total}`, page.headline);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
