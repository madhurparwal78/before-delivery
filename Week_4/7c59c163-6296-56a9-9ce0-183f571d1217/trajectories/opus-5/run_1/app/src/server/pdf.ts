const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LINE_HEIGHT = 15;
const BODY_SIZE = 10;
const HEADING_SIZE = 16;

export interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
  gap?: number;
}

/** WinAnsiEncoding code points for the characters this app prints outside ASCII. */
const WIN_ANSI: Record<string, number> = {
  '¢': 0xa2,
  '£': 0xa3,
  '€': 0x80,
  '—': 0x97,
  '–': 0x96,
  '’': 0x92,
  '‘': 0x91,
  '“': 0x93,
  '”': 0x94,
  '−': 0x2d,
  '…': 0x85,
};

function encodeText(text: string): Buffer {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63;
    const mapped = WIN_ANSI[character] ?? (code <= 0xff ? code : 63);
    if (mapped === 0x28 || mapped === 0x29 || mapped === 0x5c) bytes.push(0x5c);
    bytes.push(mapped);
  }
  return Buffer.from(bytes);
}

function contentStream(lines: readonly PdfLine[]): Buffer {
  const parts: Buffer[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    y -= line.gap ?? 0;
    const size = line.size ?? BODY_SIZE;
    parts.push(
      Buffer.from(`BT /${line.bold === true ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${MARGIN} ${y} Tm (`),
      encodeText(line.text),
      Buffer.from(') Tj ET\n'),
    );
    y -= LINE_HEIGHT;
  }
  return Buffer.concat(parts);
}

function paginate(lines: readonly PdfLine[]): PdfLine[][] {
  const perPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
  const pages: PdfLine[][] = [];
  for (let index = 0; index < lines.length; index += perPage) {
    pages.push(lines.slice(index, index + perPage));
  }
  return pages.length === 0 ? [[]] : pages;
}

/** Renders the statement as a PDF whose text is real extractable text. */
export function renderPdf(lines: readonly PdfLine[]): Buffer {
  const pages = paginate(lines);
  const objects: Buffer[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);

  objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(
    Buffer.from(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ),
  );
  objects.push(
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  );
  objects.push(
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  );

  pages.forEach((page, index) => {
    const contentId = pageObjectIds[index] as number;
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId + 1} 0 R >>`,
      ),
    );
    const stream = contentStream(page);
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from('\nendstream'),
      ]),
    );
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });

  const xrefStart = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((value) => `${value.toString().padStart(10, '0')} 00000 n \n`),
  ].join('');
  chunks.push(Buffer.from(xref));
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

export const headingLine = (text: string): PdfLine => ({ text, bold: true, size: HEADING_SIZE, gap: 8 });
export const sectionLine = (text: string): PdfLine => ({ text, bold: true, gap: 10 });
