// Minimal PDF writer producing real, selectable text.

export interface PdfDoc {
  bytes: Buffer;
}

interface Op { text: string; font: string; size: number }

const PAGE_W = 595.28;
const PAGE_H = 841.89;

export class Pdf {
  private ops: string[] = [];
  private pages: string[][] = [];
  private current: string[] = [];

  constructor() {
    this.current = [];
  }

  text(x: number, y: number, size: number, content: string, font = "F1"): this {
    this.current.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Tm (${escape(content)}) Tj ET`);
    return this;
  }

  textLines(x: number, y: number, size: number, lines: string[], leading = 16): this {
    lines.forEach((l, i) => this.text(x, y + i * leading, size, l));
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number): this {
    this.current.push(`${x1.toFixed(2)} ${(PAGE_H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - y2).toFixed(2)} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.current.push(`${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    return this;
  }

  newPage(): this {
    this.pages.push(this.current);
    this.current = [];
    return this;
  }

  build(): Buffer {
    this.pages.push(this.current);
    const pages = this.pages;
    const objects: string[] = [];
    const pageStart: number[] = [];

    // 1: catalog, 2: pages, 3: font F1, 4: font F2
    const firstPageObj = 5;
    pages.forEach((_, i) => pageStart.push(firstPageObj + i * 2));

    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] = `<< /Type /Pages /Kids [${pageStart.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
    objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

    pages.forEach((ops, i) => {
      const pageNum = pageStart[i];
      const contentNum = pageNum + 1;
      objects[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`;
      const stream = ops.join("\n");
      objects[contentNum] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefStart = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) {
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(out, "binary");
  }
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\u0080-\uffff]/g, (c) => {
    const cp = c.codePointAt(0)!;
    return `\\${Math.floor(cp / 256)}\\${cp % 256}`;
  }).replace(/[^\x20-\x7e]/g, "?");
}

export type { Op };
