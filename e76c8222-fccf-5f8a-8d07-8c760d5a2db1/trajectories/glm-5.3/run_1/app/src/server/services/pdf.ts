// Builds small single-page PDFs by hand: signed timesheets and seeded scans.

export interface TimesheetPdfData {
  ref: string;
  interpreterName: string;
  actualStart: string;
  actualEnd: string;
  billedHours: string;
  signatureName: string;
  amount: string;
  rate: string;
  approvedBy: string;
  approvedAt: string;
  title: string;
  setting: string;
  orgName: string;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// A minimal single-page PDF with Helvetica text lines.
export function buildTextPdf(lines: Array<[string, string]>): Buffer {
  let y = 720;
  const contentParts: string[] = ['BT /F1 16 Tf 64 760 Td (Signed timesheet) Tj ET'];
  contentParts.push(...lines.map(([label, value]) => {
    y -= 26;
    return `BT /F1 11 Tf 64 ${y} Td (${escapePdfText(label)}) Tj ET BT /F1 11 Tf 200 ${y} Td (${escapePdfText(value)}) Tj ET`;
  }));
  const content = contentParts.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

export function buildTimesheetPdf(data: TimesheetPdfData): Promise<Buffer> {
  const lines: Array<[string, string]> = [
    ['Ref', data.ref],
    ['Request', `${data.title} (${data.setting})`],
    ['Organisation', data.orgName],
    ['Interpreter', data.interpreterName],
    ['Actual start', data.actualStart],
    ['Actual end', data.actualEnd],
    ['Billed hours', data.billedHours],
    ['Hourly rate', `$${data.rate}`],
    ['Amount', `$${data.amount}`],
    ['Signature name', data.signatureName],
    ['Approved by', `Approved by ${data.approvedBy}`],
    ['Approval time', data.approvedAt],
  ];
  return Promise.resolve(buildTextPdf(lines));
}
