/**
 * Minimal PDF writer producing single-page PDFs with a text layer.
 * Uses Helvetica base-14 fonts, no external dependencies.
 */

export interface PdfPage {
  width: number;
  height: number;
  lines: Array<{ x: number; y: number; size: number; text: string }>;
}

function escapePdf(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // Latin-1-ish replacements for characters Helvetica lacks
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/€/g, 'EUR ')
    .replace(/[^\x20-\x7E]/g, '');
}

export class PdfBuilder {
  private page: PdfPage = { width: 595, height: 842, lines: [] };
  private y = 780;

  heading(text: string): void {
    this.page.lines.push({ x: 60, y: this.y, size: 20, text: escapePdf(text) });
    this.y -= 30;
  }

  line(text: string): void {
    this.page.lines.push({ x: 60, y: this.y, size: 11, text: escapePdf(text) });
    this.y -= 18;
  }

  spacer(): void {
    this.y -= 12;
  }

  build(): Buffer {
    const content = this.buildContent(this.page);
    const objects: string[] = [];
    // 1: catalog, 2: pages, 3: page, 4: content, 5: font, 6: font bold
    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
    objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.page.width} ${this.page.height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`;
    objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objects[6] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    const encoder = new TextEncoder();
    for (let i = 1; i <= 6; i++) {
      offsets[i] = encoder.encode(pdf).length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = encoder.encode(pdf).length;
    const total = 7;
    pdf += `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i <= 6; i++) {
      pdf += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
  }

  private buildContent(page: PdfPage): string {
    const parts: string[] = [];
    for (const l of page.lines) {
      parts.push(`BT /${l.size >= 20 ? 'F2' : 'F1'} ${l.size} Tf 1 0 0 1 ${l.x} ${l.y} Tm (${l.text}) Tj ET`);
    }
    return parts.join('\n');
  }
}

export interface ReceiptLines {
  title: string;
  recipientName: string;
  receiptNumber: string;
  itemDescription: string;
  amount: string;
  currency: string;
  date: string;
  cardLast4: string;
  accountUrl: string;
  extra?: string[];
}

/** Receipt PDF text layer: exactly the permitted receipt contents. */
export function buildReceiptPdf(lines: ReceiptLines): Buffer {
  const pdf = new PdfBuilder();
  pdf.heading(lines.title);
  pdf.spacer();
  pdf.line(`Receipt ${lines.receiptNumber}`);
  pdf.line(lines.itemDescription);
  pdf.line(`${lines.amount} ${lines.currency}`);
  pdf.line(lines.date);
  pdf.line(`Card ending ${lines.cardLast4}`);
  pdf.line(lines.accountUrl);
  for (const e of lines.extra ?? []) pdf.line(e);
  pdf.spacer();
  pdf.line(`To: ${lines.recipientName}`);
  return pdf.build();
}

export function buildTicketPdf(lines: ReceiptLines & { sessionDatetime: string; seats: number; ticketCode: string }): Buffer {
  const pdf = new PdfBuilder();
  pdf.heading(lines.title);
  pdf.spacer();
  pdf.line(`Ticket ${lines.ticketCode}`);
  pdf.line(lines.sessionDatetime);
  pdf.line(`Seats: ${lines.seats}`);
  pdf.spacer();
  pdf.line(`Receipt ${lines.receiptNumber}`);
  pdf.line(lines.itemDescription);
  pdf.line(`${lines.amount} ${lines.currency}`);
  pdf.line(lines.date);
  pdf.line(`Card ending ${lines.cardLast4}`);
  pdf.line(lines.accountUrl);
  pdf.spacer();
  pdf.line(`To: ${lines.recipientName}`);
  return pdf.build();
}
