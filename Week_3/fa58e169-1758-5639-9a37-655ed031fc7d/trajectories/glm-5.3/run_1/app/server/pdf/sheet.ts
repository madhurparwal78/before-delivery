import { env } from "../../common/env";

/**
 * A small, exact PDF writer: objects, pages, text in Helvetica, no separate
 * service and no headless browser. Text is real and extractable, lines wrap at
 * spaces, and every page ends with the published footer.
 */
export interface SheetContent {
  name: string;
  version: number;
  castOn: number;
  lines: string[];
  key: { text: string; name: string }[];
}

export function buildSheetPdf(content: SheetContent): Buffer {
  const writer = new PdfWriter();
  const linesPerPage = env.limits.sheetLinesPerPage;
  const instructionLines = content.lines.length;
  const instructionPages = Math.max(1, Math.ceil(instructionLines / linesPerPage));
  const total = 1 + instructionPages;

  // Page 1: name, version, cast on, chart note, then the key.
  const first = new PageBuilder(total, content.name);
  first.text(content.name, 48, 800, 18);
  first.text(`Version ${content.version}`, 48, 776, 12);
  first.text(`Cast on ${content.castOn} ${content.castOn === 1 ? "stitch" : "stitches"}`, 48, 758, 12);
  first.text("Chart", 48, 730, 14);
  first.text("[see the chart on the pattern page]", 48, 710, 10);
  first.text("Key", 48, 660, 14);
  let y = 640;
  for (const entry of content.key) {
    first.text(`${entry.text} ${entry.name}`, 56, y, 11);
    y -= 18;
  }
  writer.add(first);

  for (let page = 0; page < instructionPages; page++) {
    const builder = new PageBuilder(total, content.name);
    builder.text("Instructions", 48, 800, 14);
    let lineY = 780;
    for (let index = page * linesPerPage; index < Math.min((page + 1) * linesPerPage, instructionLines); index++) {
      for (const wrapped of wrap(content.lines[index]!)) {
        builder.text(wrapped, 48, lineY, 11);
        lineY -= 16;
      }
    }
    writer.add(builder);
  }

  return writer.finish();
}

function wrap(line: string): string[] {
  const width = 88;
  if (line.length <= width) return [line];
  const parts: string[] = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

class PageBuilder {
  public ops: string[] = [];
  constructor(private total: number, public pageName: string) {}
  text(value: string, x: number, y: number, size: number): void {
    const escaped = value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    this.ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escaped}) Tj ET`);
  }
  finish(pageNumber: number): string {
    const footer = `${this.pageName} - page ${pageNumber} of ${this.total}`;
    this.ops.push(`BT /F1 9 Tf 48 24 Td (${footer.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj ET`);
    return this.ops.join("\n");
  }
}

class PdfWriter {
  private objects: string[] = [];
  private pages: PageBuilder[] = [];
  private offsets: number[] = [];

  add(page: PageBuilder): void {
    this.pages.push(page);
  }

  finish(): Buffer {
    const total = this.pages.length;
    const body: string[] = ["%PDF-1.4"];
    this.offsets = [];

    let nextId = 1;
    const push = (content: string): number => {
      const id = nextId++;
      this.offsets.push(Buffer.byteLength(body.join("\n"), "utf8") + 1);
      body.push(`${id} 0 obj\n${content}\nendobj`);
      return id;
    };

    const catalogId = push("<< /Type /Catalog /Pages 2 0 R >>");
    const pageIds = this.pages.map((_, index) => 4 + index * 2);
    const pagesId = push(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${total} >>`,
    );
    const fontId = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const contents: string[] = [];
    for (let index = 0; index < total; index++) {
      contents.push(this.pages[index]!.finish(index + 1));
    }
    for (let index = 0; index < total; index++) {
      const content = contents[index]!;
      const streamId = pageIds[index]! + 1;
      push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,
      );
      push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
    }

    const xrefStart = Buffer.byteLength(body.join("\n"), "utf8") + 1;
    const xref: string[] = [`xref`, `0 ${this.offsets.length + 1}`, `0000000000 65535 f `];
    for (const offset of this.offsets) {
      xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
    }
    xref.push(`trailer`, `<< /Size ${this.offsets.length + 1} /Root ${catalogId} 0 R >>`, `startxref`, `${xrefStart}`, `%%EOF`);
    return Buffer.from([...body, ...xref].join("\n"), "utf8");
  }
}
