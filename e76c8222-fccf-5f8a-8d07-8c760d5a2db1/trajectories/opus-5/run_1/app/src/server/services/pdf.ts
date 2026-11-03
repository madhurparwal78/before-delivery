const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const LINE_HEIGHT = 18;

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (match) => `\\${match}`).replace(/[^\x20-\x7e]/g, '?');
}

/** Writes a one-page PDF holding the given lines, the first as a heading. */
export function renderPdf(lines: readonly string[]): Buffer {
  const [heading, ...rest] = lines;
  const content = [
    'BT',
    `/F1 16 Tf 1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`,
    `(${escapeText(heading ?? '')}) Tj`,
    'ET',
    'BT',
    `/F1 11 Tf ${LINE_HEIGHT} TL 1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN - 36} Tm`,
    ...rest.map((line) => `(${escapeText(line)}) Tj T*`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
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
