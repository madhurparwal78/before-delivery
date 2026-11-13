export interface TicketPdfData {
  ticketId: string;
  boardTag: string;
  makerName: string;
  pieces: Array<{ label: string; startMm: number }>;
  cuts: number[];
  takeMm: number;
  plannedOffcutMm: number | null;
  lines: Array<{ label: string; amountCents: number }>;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LINE = 16;

/** Escape a string for the PDF literal text operator. */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function centsToDollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Render the cut ticket PDF with exactly the published fields and nothing private. */
export function renderTicketPdf(data: TicketPdfData): Buffer {
  const lines: Array<{ text: string; size: number }> = [];
  lines.push({ text: `Cut ticket ${data.ticketId}`, size: 18 });
  lines.push({ text: `Board ${data.boardTag}`, size: 12 });
  lines.push({ text: `Maker ${data.makerName}`, size: 12 });
  lines.push({ text: '', size: 12 });
  lines.push({ text: 'Pieces', size: 12 });
  for (const piece of data.pieces) {
    lines.push({ text: `  ${piece.label} at ${piece.startMm} mm`, size: 11 });
  }
  lines.push({ text: '', size: 12 });
  lines.push({ text: 'Cut positions', size: 12 });
  lines.push({ text: `  ${data.cuts.map((c) => `${c} mm`).join(', ')}`, size: 11 });
  lines.push({ text: '', size: 12 });
  lines.push({ text: `Take ${data.takeMm} mm`, size: 12 });
  if (data.plannedOffcutMm !== null) {
    lines.push({ text: `Planned offcut ${data.plannedOffcutMm} mm`, size: 12 });
  }
  lines.push({ text: '', size: 12 });
  lines.push({ text: 'Invoice lines', size: 12 });
  for (const line of data.lines) {
    lines.push({ text: `  ${line.label} $${centsToDollars(line.amountCents)}`, size: 11 });
  }

  const contentParts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    if (y < MARGIN) break;
    contentParts.push(`/F1 ${line.size} Tf`);
    contentParts.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
    contentParts.push(`(${escapeText(line.text)}) Tj`);
    y -= Math.max(LINE, line.size + 6);
  }
  contentParts.push('ET');
  const content = contentParts.join('\n');

  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
    `<< /Title (Cut ticket ${escapeText(data.ticketId)}) /Producer (Kerfwell Rack) /CreationDate (D:${pdfCreationDate()}) >>`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pdfCreationDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}
