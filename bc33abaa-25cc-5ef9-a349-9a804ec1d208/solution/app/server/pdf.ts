// The invoice document: a one-page PDF with the workspace name, invoice number, date, line items, total and amount paid.
import { dollars } from "../shared/format.js";

interface InvoiceDocument {
  workspaceName: string; invoiceNumber: string; date: string;
  items: { description: string; amountCents: number }[]; totalCents: number; paidCents: number;
}

const escape = (text: string) => text.replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");

export function invoicePdf(doc: InvoiceDocument): Buffer {
  const lines: [number, number, string, number][] = [
    [72, 760, "Orrery Studio", 20],
    [72, 728, `Invoice ${doc.invoiceNumber}`, 14],
    [72, 708, `Workspace: ${doc.workspaceName}`, 11],
    [72, 692, `Date: ${doc.date}`, 11],
    [72, 660, "Line items", 12],
  ];
  let y = 640;
  for (const item of doc.items) {
    lines.push([72, y, item.description, 11], [440, y, dollars(item.amountCents), 11]);
    y -= 18;
  }
  lines.push([72, y - 12, "Total", 12], [440, y - 12, dollars(doc.totalCents), 12]);
  lines.push([72, y - 32, "Amount paid", 12], [440, y - 32, dollars(doc.paidCents), 12]);
  const content = lines.map(([x, ly, text, size]) => `BT /F1 ${size} Tf ${x} ${ly} Td (${escape(text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
