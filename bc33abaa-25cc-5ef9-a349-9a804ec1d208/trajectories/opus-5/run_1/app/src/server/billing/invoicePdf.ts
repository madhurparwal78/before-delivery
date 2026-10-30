import { formatMoney } from '../../shared/format';

export interface InvoiceDocument {
  workspaceName: string;
  invoiceNumber: string;
  date: string;
  lineItems: { description: string; amountCents: number }[];
  totalCents: number;
  amountPaidCents: number;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A single-page PDF holding the invoice figures, written without a dependency. */
export function renderInvoicePdf(document: InvoiceDocument): Buffer {
  const lines: string[] = [
    'Orrery Studio',
    `Invoice ${document.invoiceNumber}`,
    `Workspace: ${document.workspaceName}`,
    `Date: ${document.date}`,
    '',
    'Line items',
  ];
  for (const item of document.lineItems) {
    lines.push(`${item.description} — ${formatMoney(item.amountCents)}`);
  }
  lines.push('');
  lines.push(`Total: ${formatMoney(document.totalCents)}`);
  lines.push(`Amount paid: ${formatMoney(document.amountPaidCents)}`);

  const textOps = lines
    .map((line, index) => `BT /F1 ${index === 0 ? 16 : 11} Tf 56 ${760 - index * 20} Td (${escapeText(line)}) Tj ET`)
    .join('\n');
  const content = `${textOps}\n`;

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
