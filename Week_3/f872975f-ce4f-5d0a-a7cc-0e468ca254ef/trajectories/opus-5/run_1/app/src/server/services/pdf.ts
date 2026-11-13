const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const LEADING = 16;
const FONT_SIZE = 11;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LEADING);

function escapeText(line: string): string {
  let out = '';
  for (const character of line) {
    const code = character.codePointAt(0) ?? 63;
    if (character === '(' || character === ')' || character === '\\') out += `\\${character}`;
    else if (code < 32 || code > 255) out += '?';
    else out += character;
  }
  return out;
}

function contentStream(lines: string[]): Buffer {
  const parts = ['BT', `/F1 ${FONT_SIZE} Tf`, `${LEADING} TL`, `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`];
  lines.forEach((line, index) => {
    if (index > 0) parts.push('T*');
    parts.push(`(${escapeText(line)}) Tj`);
  });
  parts.push('ET');
  return Buffer.from(parts.join('\n'), 'latin1');
}

/** Writes a flat, text-only PDF whose lines are extractable. */
export function renderTextPdf(lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let at = 0; at < Math.max(lines.length, 1); at += LINES_PER_PAGE) {
    pages.push(lines.slice(at, at + LINES_PER_PAGE));
  }

  const objects: Buffer[] = [];
  const fontObject = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_page, index) => 3 + index * 2);

  objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  objects.push(
    Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'latin1')
  );
  pages.forEach((page, index) => {
    const contentId = 3 + index * 2 + 1;
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentId} 0 R >>`,
        'latin1'
      )
    );
    const stream = contentStream(page);
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
        stream,
        Buffer.from('\nendstream', 'latin1')
      ])
    );
  });
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'));

  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const chunks: Buffer[] = [header];
  let position = header.length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1')
    ]);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefAt = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
