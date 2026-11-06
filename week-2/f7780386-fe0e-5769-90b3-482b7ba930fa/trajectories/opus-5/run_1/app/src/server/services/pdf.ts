/**
 * A small PDF writer for compliance packets and seeded certificate stand-ins.
 * It emits real text operators with the base-14 Helvetica faces, so the text
 * can be extracted rather than rasterised.
 */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const DEFAULT_SIZE = 10;

/** WinAnsi is Latin-1 compatible above 0xA0, which covers the seeded names. */
function toWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 0x2014) bytes.push(0x97);
    else if (code === 0x2013) bytes.push(0x96);
    else if (code === 0x2019) bytes.push(0x92);
    else if (code <= 0xff && (code >= 0x20 || code === 0x0a)) bytes.push(code);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function escapeText(text: string): Buffer {
  const source = toWinAnsi(text);
  const out: number[] = [];
  for (const byte of source) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return Buffer.from(out);
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  // Helvetica averages close to 0.5 em across mixed case; this keeps lines
  // inside the margins without embedding a width table.
  const perChar = size * 0.52;
  const limit = Math.max(16, Math.floor(maxWidth / perChar));
  if (text.length <= limit) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      if (current !== '') lines.push(current);
      current = word.length <= limit ? word : word.slice(0, limit);
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

export function renderTextPdf(lines: readonly PdfLine[]): Buffer {
  const pages: Buffer[] = [];
  let content: Buffer[] = [];
  let cursor = PAGE_HEIGHT - MARGIN;

  const flush = (): void => {
    if (content.length > 0) pages.push(Buffer.concat(content));
    content = [];
    cursor = PAGE_HEIGHT - MARGIN;
  };

  for (const line of lines) {
    const size = line.size ?? DEFAULT_SIZE;
    const font = line.bold === true ? '/F2' : '/F1';
    const leading = size * 1.45 + (line.gap ?? 0);
    for (const piece of wrap(line.text, size, PAGE_WIDTH - MARGIN * 2)) {
      if (cursor - leading < MARGIN) flush();
      cursor -= leading;
      content.push(
        Buffer.concat([
          Buffer.from(`BT ${font} ${size} Tf 1 0 0 1 ${MARGIN} ${cursor.toFixed(2)} Tm (`, 'latin1'),
          escapeText(piece),
          Buffer.from(') Tj ET\n', 'latin1'),
        ]),
      );
    }
  }
  flush();
  if (pages.length === 0) pages.push(Buffer.from('', 'latin1'));

  const objects: Buffer[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');

  objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  objects.push(
    Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`, 'latin1'),
  );
  objects.push(
    Buffer.from(
      '<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
        '/Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 ' +
        '/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >>',
      'latin1',
    ),
  );

  for (const [index, page] of pages.entries()) {
    const contentId = pageObjectIds[index]! + 1;
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources 3 0 R /Contents ${contentId} 0 R >>`,
        'latin1',
      ),
    );
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${page.byteLength} >>\nstream\n`, 'latin1'),
        page,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0]!.byteLength;
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const piece = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    chunks.push(piece);
    offset += piece.byteLength;
  }

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) {
    xref += `${String(value).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}
