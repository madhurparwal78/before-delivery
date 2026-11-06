import qrcode from 'qrcode-generator';

interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  grey: number;
}

const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 595;

/** Code points WinAnsiEncoding places outside Latin-1. */
const WIN_ANSI_EXTRAS = new Map<string, number>([
  ['\u2013', 0x96],
  ['\u2014', 0x97],
  ['\u2018', 0x91],
  ['\u2019', 0x92],
  ['\u201c', 0x93],
  ['\u201d', 0x94],
  ['\u2022', 0x95],
  ['\u2026', 0x85],
]);

function escapeText(text: string): string {
  const bytes: number[] = [];
  for (const character of text.normalize('NFC')) {
    const extra = WIN_ANSI_EXTRAS.get(character);
    if (extra !== undefined) {
      bytes.push(extra);
      continue;
    }
    const code = character.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return Buffer.from(bytes)
    .toString('latin1')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function qrRects(payload: string, originX: number, originY: number, size: number): Rect[] {
  const code = qrcode(0, 'M');
  code.addData(payload);
  code.make();
  const count = code.getModuleCount();
  const module = size / count;
  const rects: Rect[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!code.isDark(row, column)) continue;
      rects.push({
        x: originX + column * module,
        y: originY + size - (row + 1) * module,
        width: module,
        height: module,
        grey: 0,
      });
    }
  }
  return rects;
}

export interface PassPdfFields {
  holderName: string;
  itemTitle: string;
  whenText: string;
  venueName: string;
  passCode: string;
}

/** A pass PDF shows only the holder, item, time or day, venue and pass code. */
export function renderPassPdf(fields: PassPdfFields): Buffer {
  const runs: TextRun[] = [
    { text: 'KERF FREQUENCIES 2027', x: 40, y: 540, size: 13, bold: true },
    { text: 'Holder', x: 40, y: 500, size: 9, bold: false },
    { text: fields.holderName, x: 40, y: 482, size: 16, bold: true },
    { text: 'Item', x: 40, y: 450, size: 9, bold: false },
    { text: fields.itemTitle, x: 40, y: 432, size: 16, bold: true },
    { text: 'When', x: 40, y: 400, size: 9, bold: false },
    { text: fields.whenText, x: 40, y: 382, size: 13, bold: false },
    { text: 'Venue', x: 40, y: 350, size: 9, bold: false },
    { text: fields.venueName, x: 40, y: 332, size: 13, bold: false },
    { text: 'Pass code', x: 40, y: 300, size: 9, bold: false },
    { text: fields.passCode, x: 40, y: 282, size: 15, bold: true },
  ];
  const rects: Rect[] = [
    { x: 40, y: 520, width: 340, height: 1.2, grey: 0 },
    ...qrRects(fields.passCode, 40, 110, 150),
  ];
  return buildPdf(runs, rects);
}

function buildPdf(runs: readonly TextRun[], rects: readonly Rect[]): Buffer {
  const content: string[] = [];
  for (const rect of rects) {
    content.push(
      `${rect.grey} g ${rect.x.toFixed(2)} ${rect.y.toFixed(2)} ${rect.width.toFixed(2)} ${rect.height.toFixed(
        2,
      )} re f`,
    );
  }
  content.push('0 g');
  for (const run of runs) {
    content.push(
      `BT /${run.bold ? 'F2' : 'F1'} ${run.size} Tf ${run.x} ${run.y} Td (${escapeText(
        run.text,
      )}) Tj ET`,
    );
  }
  const stream = content.join('\n');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
