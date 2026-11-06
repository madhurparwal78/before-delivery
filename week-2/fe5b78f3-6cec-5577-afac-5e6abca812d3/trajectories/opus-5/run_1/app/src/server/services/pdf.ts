/**
 * A minimal PDF writer. Pages carry Helvetica text with a ToUnicode CMap, so every line is
 * extractable exactly as written, the rupee sign included.
 */

export interface PdfLine {
  readonly text: string;
  readonly bold?: boolean;
  readonly gap?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 54;
const BODY_SIZE = 11;
const HEADING_SIZE = 15;
const LINE_HEIGHT = 17;

/** WinAnsi code points that differ from Latin-1, limited to the characters this app prints. */
const WINANSI_OVERRIDES = new Map<number, number>([
  [0x20b9, 0x80],
  [0x2014, 0x97],
  [0x2013, 0x96],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
]);

function encodeText(text: string, used: Set<number>): { bytes: number[] } {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0x3f;
    const mapped = WINANSI_OVERRIDES.get(code) ?? (code <= 0xff ? code : 0x3f);
    bytes.push(mapped);
    used.add(mapped);
  }
  return { bytes };
}

function pdfString(bytes: readonly number[]): string {
  let out = '(';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

function toUnicodeCMap(used: ReadonlySet<number>): string {
  const reverse = new Map<number, number>();
  for (const [unicode, code] of WINANSI_OVERRIDES) reverse.set(code, unicode);
  const entries = [...used]
    .sort((a, b) => a - b)
    .map((code) => {
      const unicode = reverse.get(code) ?? code;
      return `<${code.toString(16).padStart(2, '0')}> <${unicode.toString(16).padStart(4, '0')}>`;
    });
  const chunks: string[] = [];
  for (let index = 0; index < entries.length; index += 100) {
    const slice = entries.slice(index, index + 100);
    chunks.push(`${slice.length} beginbfchar\n${slice.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /Pakka-WinAnsi def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <ff>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

export function renderPdf(lines: readonly PdfLine[]): Buffer {
  const used = new Set<number>();
  const pages: string[] = [];
  let content: string[] = [];
  let cursor = PAGE_HEIGHT - MARGIN;

  const flush = (): void => {
    if (content.length > 0) pages.push(content.join('\n'));
    content = [];
    cursor = PAGE_HEIGHT - MARGIN;
  };

  for (const line of lines) {
    cursor -= line.gap ?? 0;
    if (cursor < MARGIN) flush();
    const size = line.bold === true ? HEADING_SIZE : BODY_SIZE;
    const font = line.bold === true ? '/F2' : '/F1';
    const { bytes } = encodeText(line.text, used);
    content.push(
      `BT ${font} ${size} Tf 1 0 0 1 ${MARGIN} ${cursor.toFixed(2)} Tm ${pdfString(bytes)} Tj ET`,
    );
    cursor -= LINE_HEIGHT;
  }
  flush();
  if (pages.length === 0) pages.push('');

  const objects: string[] = [];
  const reserve = (): number => {
    objects.push('');
    return objects.length;
  };

  const catalogId = reserve();
  const pagesId = reserve();
  const toUnicodeId = reserve();
  const regularId = reserve();
  const boldId = reserve();
  const pageIds = pages.map(() => reserve());
  const contentIds = pages.map(() => reserve());

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pages.length} /Kids [`
    + `${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  const cmap = toUnicodeCMap(used);
  objects[toUnicodeId - 1] = `<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`;
  objects[regularId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica'
    + ` /Encoding /WinAnsiEncoding /ToUnicode ${toUnicodeId} 0 R >>`;
  objects[boldId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold'
    + ` /Encoding /WinAnsiEncoding /ToUnicode ${toUnicodeId} 0 R >>`;
  pages.forEach((body, index) => {
    objects[pageIds[index] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R`
      + ` /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`
      + ` /Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >>`
      + ` /Contents ${contentIds[index]} 0 R >>`;
    objects[contentIds[index] - 1] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>`
      + `\nstream\n${body}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
