import PDFDocument from 'pdfkit';

const LINES_PER_PAGE = 25;

async function render(header: string, bodyLines: string[], tailLines: string[]): Promise<Buffer> {
  const pages: string[][] = [];
  for (let index = 0; index < bodyLines.length; index += LINES_PER_PAGE) {
    pages.push(bodyLines.slice(index, index + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const document = new PDFDocument({ autoFirstPage: false, margin: 48, size: 'A4', compress: false });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => document.on('end', () => resolve()));

  pages.forEach((lines, index) => {
    document.addPage();
    document.font('Helvetica-Bold').fontSize(13).text(header, { lineGap: 2 });
    document.moveDown(0.6);
    document.font('Helvetica').fontSize(10.5);
    for (const line of lines) document.text(line, { lineGap: 2 });
    if (index === pages.length - 1 && tailLines.length > 0) {
      document.moveDown(0.6);
      for (const line of tailLines) document.text(line, { lineGap: 2 });
    }
    document.moveDown(0.8);
    document.font('Helvetica').fontSize(9.5).text(`Page ${index + 1} of ${pages.length}`);
  });

  document.end();
  await finished;
  return Buffer.concat(chunks);
}

export function historyPdf(input: {
  patientName: string;
  entries: string[];
  files: string[];
}): Promise<Buffer> {
  return render(`Patient: ${input.patientName}`, [...input.entries, ...input.files], []);
}

export function invoicePdf(input: {
  number: string;
  lines: string[];
  totals: string[];
}): Promise<Buffer> {
  return render(`Invoice ${input.number}`, input.lines, input.totals);
}
