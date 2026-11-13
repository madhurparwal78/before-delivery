/**
 * A minimal single-page PDF writer. The text layer holds exactly the lines it is given,
 * so a receipt PDF carries the same facts as its receipt email and nothing else.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT_MARGIN = 64;
const TOP_MARGIN = 96;
const LINE_HEIGHT = 22;

function escapeText(line: string): string {
  return line.replace(/[\\()]/g, (character) => `\\${character}`);
}

/** PDFDocEncoding covers Latin-1 plus the currency and punctuation marks receipts use. */
const DOC_ENCODING: Record<string, number> = { '€': 0xa0, '—': 0x97, '’': 0x92, '“': 0x93, '”': 0x94 };

function toDocEncoding(line: string): Buffer {
  const bytes: number[] = [];
  for (const character of line) {
    const mapped = DOC_ENCODING[character];
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const code = character.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return Buffer.from(bytes);
}

export function renderReceiptPdf(title: string, lines: string[]): Buffer {
  const content: Buffer[] = [Buffer.from('BT\n/F2 20 Tf\n', 'latin1')];
  content.push(Buffer.from(`1 0 0 1 ${LEFT_MARGIN} ${PAGE_HEIGHT - TOP_MARGIN} Tm\n(`, 'latin1'));
  content.push(toDocEncoding(escapeText(title)));
  content.push(Buffer.from(`) Tj\nET\n`, 'latin1'));
  content.push(Buffer.from('BT\n/F1 12 Tf\n', 'latin1'));
  content.push(
    Buffer.from(`1 0 0 1 ${LEFT_MARGIN} ${PAGE_HEIGHT - TOP_MARGIN - 36} Tm\n${LINE_HEIGHT} TL\n`, 'latin1'),
  );
  for (const line of lines) {
    content.push(Buffer.from('(', 'latin1'));
    content.push(toDocEncoding(escapeText(line)));
    content.push(Buffer.from(') Tj T*\n', 'latin1'));
  }
  content.push(Buffer.from('ET\n', 'latin1'));
  const stream = Buffer.concat(content);

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
      'latin1',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>', 'latin1'),
  ];

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = parts[0]?.length ?? 0;
  objects.forEach((object, index) => {
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const suffix = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(position);
    const body = Buffer.concat([prefix, object, suffix]);
    parts.push(body);
    position += body.length;
  });
  const xrefStart = position;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (const offset of offsets) xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  parts.push(Buffer.from(xrefLines.join(''), 'latin1'));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(parts);
}
