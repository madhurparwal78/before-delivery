import type { Project } from "../shared/types";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 40;
const ROWS_PER_PAGE = 20;
const ROW_HEIGHT = 20;
const NAME_WIDTH = 380;
const FONT_SIZE = 10;
const COLUMNS = { row: MARGIN, name: 84, start: 490, end: 580, duration: 670, percent: 750 };
const HEADINGS = { row: "Row", name: "Name", start: "Start", end: "End", duration: "Duration", percent: "Percent" };

const GLYPH_WIDTHS = "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
  .split(" ")
  .map(Number);

function width(text: string): number {
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code <= 126 ? GLYPH_WIDTHS[code - 32] : 556;
  }
  return (units * FONT_SIZE) / 1000;
}

function fit(text: string, limit: number): string {
  if (width(text) <= limit) return text;
  let shortened = text;
  while (shortened.length > 1 && width(`${shortened}...`) > limit) shortened = shortened.slice(0, -1);
  return `${shortened}...`;
}

function literal(text: string): string {
  const bytes = [...text].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126 ? char : code >= 160 && code <= 255 ? String.fromCharCode(code) : "?";
  });
  return `(${bytes.join("").replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

const showAt = (x: number, y: number, size: number, font: string, text: string): string => `BT /${font} ${size} Tf ${x} ${y} Td ${literal(text)} Tj ET`;

function utf16Hex(text: string): string {
  return `<FEFF${[...text].map((char) => (char.codePointAt(0) ?? 63).toString(16).padStart(4, "0")).join("")}>`;
}

/** An A4 landscape PDF with the project name as its title, 20 rows a page and `Page n of N` at the foot. */
export function renderPdf(project: Project): Buffer {
  const pageCount = Math.max(1, Math.ceil(project.items.length / ROWS_PER_PAGE));
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R /Lang (en) >>");
  objects.push(`<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, page) => `${6 + page * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.push(`<< /Title ${utf16Hex(project.name)} /Producer (Slackwater Plan) >>`);
  const top = PAGE_HEIGHT - MARGIN;
  for (let page = 0; page < pageCount; page++) {
    const lines = [
      showAt(MARGIN, top - 14, 16, "F2", fit(project.name, PAGE_WIDTH - 2 * MARGIN)),
      ...Object.entries(HEADINGS).map(([column, heading]) => showAt(COLUMNS[column as keyof typeof COLUMNS], top - 44, FONT_SIZE, "F2", heading)),
    ];
    project.items.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE).forEach((item, index) => {
      const y = top - 44 - ROW_HEIGHT * (index + 1);
      lines.push(
        showAt(COLUMNS.row, y, FONT_SIZE, "F1", String(item.row)),
        showAt(COLUMNS.name, y, FONT_SIZE, "F1", fit(item.name, NAME_WIDTH)),
        showAt(COLUMNS.start, y, FONT_SIZE, "F1", item.start ?? ""),
        showAt(COLUMNS.end, y, FONT_SIZE, "F1", item.end ?? ""),
        showAt(COLUMNS.duration, y, FONT_SIZE, "F1", String(item.duration)),
        showAt(COLUMNS.percent, y, FONT_SIZE, "F1", `${item.percent}%`),
      );
    });
    lines.push(showAt(MARGIN, MARGIN - 10, FONT_SIZE, "F1", `Page ${page + 1} of ${pageCount}`));
    const content = lines.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + page * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
