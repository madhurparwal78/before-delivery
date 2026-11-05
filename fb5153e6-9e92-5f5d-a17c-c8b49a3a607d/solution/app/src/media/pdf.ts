/**
 * The invoice PDF the app renders in the receipt's locale. Text is written with
 * the standard Helvetica font in WinAnsiEncoding, with a ToUnicode map, so it
 * extracts character for character as written.
 */

/** The few characters outside Latin-1 that the published copy uses. */
const WINANSI_EXTRAS: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‹': 0x8b,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '›': 0x9b,
};

/** WinAnsiEncoding draws 0xa0 with the space glyph, so the no-break space in a
 * German amount only survives extraction when the Unicode is stated outright. */
function toUnicodeCMap(): string {
  const hex = (value: number, digits: number): string =>
    value.toString(16).padStart(digits, '0');
  const extras = Object.entries(WINANSI_EXTRAS);
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /Turnstone-WinAnsi def',
    '/CMapType 2 def',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '1 begincodespacerange',
    '<00> <ff>',
    'endcodespacerange',
    '2 beginbfrange',
    '<00> <7f> <0000>',
    '<a0> <ff> <00a0>',
    'endbfrange',
    `${extras.length + 1} beginbfchar`,
    // WinAnsiEncoding names 0xa0 /space, and extractors prefer that name over a
    // bfrange, so the no-break space needs its own bfchar to survive extraction.
    '<a0> <00a0>',
    ...extras.map(
      ([character, code]) =>
        `<${hex(code, 2)}> <${hex(character.codePointAt(0) ?? 0x3f, 4)}>`,
    ),
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

function toWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const extra = WINANSI_EXTRAS[ch];
    if (extra !== undefined) {
      bytes.push(extra);
      continue;
    }
    const code = ch.codePointAt(0) ?? 0x3f;
    bytes.push(code <= 0xff ? code : 0x3f);
  }
  return Buffer.from(bytes);
}

function escapeLiteral(bytes: Buffer): Buffer {
  const out: number[] = [];
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return Buffer.from(out);
}

export interface InvoiceLine {
  readonly text: string;
  readonly size: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 64;

/** Builds a one-page PDF whose extractable text is exactly these lines. */
export function renderInvoicePdf(lines: readonly InvoiceLine[]): Buffer {
  const parts: Buffer[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    y -= line.size + 10;
    parts.push(
      Buffer.from(`BT /F1 ${line.size} Tf 1 0 0 1 ${MARGIN} ${y} Tm (`, 'latin1'),
      escapeLiteral(toWinAnsi(line.text)),
      Buffer.from(') Tj ET\n', 'latin1'),
    );
  }
  const content = Buffer.concat(parts);
  const cmap = toUnicodeCMap();

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      'latin1',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding ' +
        '/ToUnicode 6 0 R >>',
      'latin1',
    ),
    Buffer.from(
      `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
      'latin1',
    ),
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets.push(position);
    const body = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    chunks.push(body);
    position += body.length;
  });

  const xrefStart = position;
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n `);
  chunks.push(
    Buffer.from(
      `${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${xrefStart}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}
