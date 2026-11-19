/** A minimal PDF writer: standard-font text, so every line can be extracted as text. */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const LINE_HEIGHT = 15;
const FONT_SIZE = 10.5;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/** WinAnsi codes for the few typographic characters the log text uses. */
const WIN_ANSI: Record<string, number> = {
  '\u2014': 0x97,
  '\u2013': 0x96,
  '\u2022': 0x95,
  '\u00b7': 0xb7,
  '\u2026': 0x85,
  '\u2019': 0x92,
  '\u2018': 0x91,
  '\u201c': 0x93,
  '\u201d': 0x94,
};

function escapeText(line: string): string {
  let out = '';
  for (const char of line) {
    const code = char.codePointAt(0) ?? 63;
    const mapped = WIN_ANSI[char];
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (mapped !== undefined) out += String.fromCharCode(mapped);
    else if (code < 32 || code > 255) out += '?';
    else out += char;
  }
  return out;
}

function contentStream(lines: string[]): string {
  const parts = ['BT', `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`, `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`];
  for (const line of lines) {
    parts.push(`(${escapeText(line)}) Tj`, 'T*');
  }
  parts.push('ET');
  return parts.join('\n');
}

export function renderTextPdf(lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(1, lines.length); index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  pages.forEach((pageLines, index) => {
    const contentId = pageObjectIds[index] as number;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId + 1} 0 R >>`,
    );
    const stream = contentStream(pageLines);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}
