import { formatMoney, type Money } from "../shared/money.js";
import { type KbInvoice } from "./services/killbill.js";

function winAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return Buffer.from(bytes);
}

function escapeText(text: string): Buffer {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  return winAnsi(escaped);
}

interface Line {
  text: string;
  size: number;
  bold: boolean;
}

function contentStream(lines: Line[]): Buffer {
  const parts: Buffer[] = [Buffer.from("BT\n")];
  let y = 780;
  for (const line of lines) {
    parts.push(Buffer.from(`/${line.bold ? "F2" : "F1"} ${line.size} Tf\n1 0 0 1 56 ${y} Tm\n(`));
    parts.push(escapeText(line.text));
    parts.push(Buffer.from(") Tj\n"));
    y -= Math.round(line.size * 1.7);
  }
  parts.push(Buffer.from("ET\n"));
  return Buffer.concat(parts);
}

function buildPdf(lines: Line[]): Buffer {
  const content = contentStream(lines);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    const header = Buffer.from(`${index + 1} 0 obj\n`);
    const footer = Buffer.from("\nendobj\n");
    offsets.push(offset);
    const body = Buffer.concat([header, object, footer]);
    chunks.push(body);
    offset += body.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) {
    xref += `${value.toString().padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

export function documentPdf(title: string, body: string[]): Buffer {
  return buildPdf([
    { text: title, size: 20, bold: true },
    ...body.map((text) => ({ text, size: 12, bold: false })),
  ]);
}

export function invoicePdf(input: {
  invoice: KbInvoice;
  businessName: string;
  orderNumber: string;
}): Buffer {
  const lines: Line[] = [
    { text: "Pampero Build Co.", size: 20, bold: true },
    { text: `Invoice ${input.invoice.invoiceNumber}`, size: 14, bold: true },
    { text: `Date: ${input.invoice.invoiceDate}`, size: 11, bold: false },
    { text: `Business: ${input.businessName}`, size: 11, bold: false },
    { text: `Order: ${input.orderNumber}`, size: 11, bold: false },
    { text: `Currency: ${input.invoice.currency}`, size: 11, bold: false },
    { text: "", size: 11, bold: false },
    { text: "Items", size: 12, bold: true },
  ];
  for (const item of input.invoice.items) {
    lines.push({
      text: `${item.description || item.itemType} — ${formatMoney(item.amount)}`,
      size: 11,
      bold: false,
    });
  }
  lines.push({ text: "", size: 11, bold: false });
  lines.push({ text: `Total: ${formatMoney(input.invoice.amount as Money)}`, size: 12, bold: true });
  lines.push({ text: `Balance: ${formatMoney(input.invoice.balance as Money)}`, size: 12, bold: true });
  return buildPdf(lines);
}
