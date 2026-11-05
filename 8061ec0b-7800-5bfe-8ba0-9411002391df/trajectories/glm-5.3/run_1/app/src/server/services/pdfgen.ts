// Minimal PDF writing for signed agreements and bills of sale (DP-07,
// DP-57). The text is uncompressed so its values appear as plain text in the
// file, and the file starts with %PDF-.

export interface PdfLine {
  text: string;
  size?: number;
  gapAfter?: number;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const frac = cents % 100;
  return `$${dollars.toLocaleString("en-US")}.${String(frac).padStart(2, "0")}`;
}

export function buildPdf(title: string, lines: PdfLine[]): Uint8Array {
  const ops: string[] = [];
  let y = 740;
  ops.push(`BT /F2 20 Tf 56 ${y} Td (${escapePdfText(title)}) Tj ET`);
  y -= 34;
  for (const line of lines) {
    const size = line.size ?? 11;
    ops.push(`BT /F1 ${size} Tf 56 ${y} Td (${escapePdfText(line.text)}) Tj ET`);
    y -= size + 6 + (line.gapAfter ?? 4);
  }
  ops.push(`BT /F1 9 Tf 56 56 Td (Keel & Bell Music - Bellroll rentals) Tj ET`);
  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

export interface AgreementPdfData {
  contractId: string;
  studentName: string;
  serial: string;
  instrumentLabel: string;
  priceListId: string;
  baseRentCents: number;
  waiverCents: number | null;
  purchasePriceCents: number;
  taxPercent: string;
  termMonths: number;
  tierLabels: string[];
  fullName: string;
  signedAtText: string;
}

export async function agreementPdf(data: AgreementPdfData): Promise<Uint8Array> {
  const waiverLine =
    data.waiverCents !== null
      ? `Monthly maintenance and damage waiver: ${money(data.waiverCents)}`
      : "Maintenance and damage waiver: declined";
  const lines: PdfLine[] = [
    { text: `Rental agreement ${data.contractId}`, size: 14 },
    { text: "" },
    {
      text:
        "Keel & Bell Music rents the instrument below to the student's family on a rent-to-own contract. Each month's base",
    },
    {
      text:
        "rent adds equity toward the published purchase price. An early buyout takes a stepped discount off the remaining",
    },
    {
      text:
        "balance, and the discount shrinks as the contract ages. This agreement is signed electronically by the parent.",
    },
    { text: "" },
    { text: `Student: ${data.studentName}` },
    { text: `Instrument: ${data.instrumentLabel} ${data.serial}` },
    { text: `Price list: ${data.priceListId}` },
    { text: `Monthly base rent: ${money(data.baseRentCents)}` },
    { text: waiverLine },
    { text: `Purchase price: ${money(data.purchasePriceCents)}` },
    { text: `Sales tax at ${data.taxPercent} (the rate in force when billed applies).` },
    { text: `Term: ${data.termMonths} months` },
    { text: "" },
    { text: "Early buyout discount schedule:", size: 12 },
    ...data.tierLabels.map((label) => ({ text: label })),
    { text: "" },
    {
      text:
        "By signing, the renter agrees to the terms above and to return the instrument in good condition at the end of the",
    },
    { text: "rental, or to complete a buyout as described." },
    { text: "" },
    { text: `Signed by: ${data.fullName}` },
    { text: `Signed at: ${data.signedAtText}` },
  ];
  return buildPdf(`Rental agreement ${data.contractId}`, lines);
}

export interface BillOfSaleData {
  contractId: string;
  parentName: string;
  studentName: string;
  instrumentLabel: string;
  serial: string;
  amountPaidText: string;
  closeTimeText: string;
}

export async function billOfSalePdf(data: BillOfSaleData): Promise<Uint8Array> {
  const lines: PdfLine[] = [
    { text: `Bill of sale ${data.contractId}`, size: 14 },
    { text: "" },
    { text: "Paid in full", size: 16 },
    { text: "" },
    { text: "Keel & Bell Music sells the instrument below to the student's family." },
    { text: "" },
    { text: `Buyer: ${data.parentName}` },
    { text: `Student: ${data.studentName}` },
    { text: `Instrument: ${data.instrumentLabel} ${data.serial}` },
    { text: `Amount paid: ${data.amountPaidText}` },
    { text: `Close time: ${data.closeTimeText}` },
    { text: "" },
    { text: "Ownership of this instrument transfers to the buyer at the close time above." },
  ];
  return buildPdf(`Bill of sale ${data.contractId}`, lines);
}
