import { PDFDocument, StandardFonts } from 'pdf-lib';

/** One page per 25 body lines (an empty body still makes one page); extra lines follow the body on the last page. */
const LINES_PER_PAGE = 25;

export interface PdfContent {
  /** Printed at the top of every page. */
  heading: string;
  body: string[];
  /** Printed after the body on the last page only; they do not count toward the 25 lines. */
  closing: string[];
  created: Date;
}

const PAGE = { width: 595, height: 842 };
const LINE = 16;

export async function renderPdf(content: PdfContent): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(font.getCharacterSet());
  const clean = (text: string) => [...text].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  doc.setCreationDate(content.created);
  doc.setModificationDate(content.created);
  doc.setProducer('Roundbook');
  doc.setCreator('Roundbook');

  const pageCount = Math.max(1, Math.ceil(content.body.length / LINES_PER_PAGE));
  for (let index = 0; index < pageCount; index++) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawText(clean(content.heading), { x: 50, y: 790, size: 15, font: bold });
    const lines = content.body.slice(index * LINES_PER_PAGE, (index + 1) * LINES_PER_PAGE);
    lines.forEach((text, i) => page.drawText(clean(text), { x: 50, y: 755 - i * LINE, size: 11, font }));
    if (index === pageCount - 1) {
      const start = 755 - lines.length * LINE - 22;
      content.closing.forEach((text, i) => page.drawText(clean(text), { x: 50, y: start - i * LINE, size: 11, font: i < 3 ? bold : font }));
    }
    page.drawText(`Page ${index + 1} of ${pageCount}`, { x: 50, y: 36, size: 10, font });
  }
  return Buffer.from(await doc.save());
}
