/** A small PDF writer with one embedded TrueType font, so invoices hold real selectable text. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONT_PATH = fileURLToPath(new URL('../../../assets/lexend.ttf', import.meta.url));

type FontMetrics = {
  bytes: Buffer;
  unitsPerEm: number;
  glyphFor: (codePoint: number) => number;
  advanceFor: (glyphId: number) => number;
  ascender: number;
  descender: number;
};

function readFont(): FontMetrics {
  const bytes = readFileSync(FONT_PATH);
  const tableCount = bytes.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    tables.set(bytes.toString('latin1', offset, offset + 4), bytes.readUInt32BE(offset + 8));
  }
  const head = tables.get('head') ?? 0;
  const unitsPerEm = bytes.readUInt16BE(head + 18);
  const hhea = tables.get('hhea') ?? 0;
  const ascender = bytes.readInt16BE(hhea + 4);
  const descender = bytes.readInt16BE(hhea + 6);
  const numberOfHMetrics = bytes.readUInt16BE(hhea + 34);
  const hmtx = tables.get('hmtx') ?? 0;

  const cmap = tables.get('cmap') ?? 0;
  const subtableCount = bytes.readUInt16BE(cmap + 2);
  let format4 = 0;
  for (let index = 0; index < subtableCount; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = bytes.readUInt16BE(record);
    const encoding = bytes.readUInt16BE(record + 2);
    const offset = bytes.readUInt32BE(record + 4);
    if (platform === 3 && (encoding === 1 || encoding === 0)) format4 = cmap + offset;
  }
  const segmentCountX2 = bytes.readUInt16BE(format4 + 6);
  const endCodes = format4 + 14;
  const startCodes = endCodes + segmentCountX2 + 2;
  const deltas = startCodes + segmentCountX2;
  const rangeOffsets = deltas + segmentCountX2;

  const glyphFor = (codePoint: number): number => {
    for (let segment = 0; segment < segmentCountX2 / 2; segment += 1) {
      const end = bytes.readUInt16BE(endCodes + segment * 2);
      if (codePoint > end) continue;
      const start = bytes.readUInt16BE(startCodes + segment * 2);
      if (codePoint < start) return 0;
      const rangeOffset = bytes.readUInt16BE(rangeOffsets + segment * 2);
      if (rangeOffset === 0) {
        return (codePoint + bytes.readInt16BE(deltas + segment * 2)) & 0xffff;
      }
      const glyphIndex = bytes.readUInt16BE(
        rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2,
      );
      if (glyphIndex === 0) return 0;
      return (glyphIndex + bytes.readInt16BE(deltas + segment * 2)) & 0xffff;
    }
    return 0;
  };

  const advanceFor = (glyphId: number): number => {
    const index = Math.min(glyphId, numberOfHMetrics - 1);
    return bytes.readUInt16BE(hmtx + index * 4);
  };

  return { bytes, unitsPerEm, glyphFor, advanceFor, ascender, descender };
}

let cachedFont: FontMetrics | null = null;
function font(): FontMetrics {
  cachedFont ??= readFont();
  return cachedFont;
}

export type PdfLine = { text: string; size?: number; gap?: number };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

export function renderPdf(lines: PdfLine[]): Buffer {
  const metrics = font();
  const usedGlyphs = new Map<number, number>();
  const pages: string[] = [];
  let content = '';
  let cursorY = PAGE_HEIGHT - MARGIN;

  const drawLine = (line: PdfLine): void => {
    const size = line.size ?? 11;
    const advance = size * 1.45 + (line.gap ?? 0);
    if (cursorY - advance < MARGIN) {
      pages.push(content);
      content = '';
      cursorY = PAGE_HEIGHT - MARGIN;
    }
    cursorY -= advance;
    let hex = '';
    for (const character of line.text) {
      const codePoint = character.codePointAt(0) ?? 32;
      const glyphId = metrics.glyphFor(codePoint);
      usedGlyphs.set(glyphId, metrics.advanceFor(glyphId));
      hex += glyphId.toString(16).padStart(4, '0');
    }
    content += `BT /F1 ${size.toFixed(2)} Tf 1 0 0 1 ${MARGIN} ${cursorY.toFixed(2)} Tm <${hex}> Tj ET\n`;
  };

  for (const line of lines) drawLine(line);
  pages.push(content);

  const objects: Buffer[] = [];
  const addObject = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length;
  };

  const fontFileId = addObject(
    Buffer.concat([
      Buffer.from(
        `<< /Length ${metrics.bytes.length} /Length1 ${metrics.bytes.length} >>\nstream\n`,
        'latin1',
      ),
      metrics.bytes,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  );
  const scale = 1000 / metrics.unitsPerEm;
  const descriptorId = addObject(
    `<< /Type /FontDescriptor /FontName /Lexend /Flags 32 /FontBBox [0 ${Math.round(
      metrics.descender * scale,
    )} 1000 ${Math.round(metrics.ascender * scale)}] /ItalicAngle 0 /Ascent ${Math.round(
      metrics.ascender * scale,
    )} /Descent ${Math.round(metrics.descender * scale)} /CapHeight 700 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`,
  );
  const widths = [...usedGlyphs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([glyphId, advance]) => `${glyphId} [${Math.round(advance * scale)}]`)
    .join(' ');
  const cidFontId = addObject(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Lexend /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 600 /W [${widths}] /CIDToGIDMap /Identity >>`,
  );
  const toUnicodeEntries = [...usedGlyphs.keys()];
  const reverse = new Map<number, number>();
  for (const line of lines) {
    for (const character of line.text) {
      const codePoint = character.codePointAt(0) ?? 32;
      reverse.set(metrics.glyphFor(codePoint), codePoint);
    }
  }
  const cmapStream = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Identity-H def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${toUnicodeEntries.length} beginbfchar
${toUnicodeEntries
  .map(
    (glyphId) =>
      `<${glyphId.toString(16).padStart(4, '0')}> <${(reverse.get(glyphId) ?? 32)
        .toString(16)
        .padStart(4, '0')}>`,
  )
  .join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const toUnicodeId = addObject(
    `<< /Length ${Buffer.byteLength(cmapStream, 'latin1')} >>\nstream\n${cmapStream}\nendstream`,
  );
  const fontId = addObject(
    `<< /Type /Font /Subtype /Type0 /BaseFont /Lexend /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
  );

  const pagesId = objects.length + pages.length * 2 + 1;
  const pageIds: number[] = [];
  for (const pageContent of pages) {
    const streamId = addObject(
      `<< /Length ${Buffer.byteLength(pageContent, 'latin1')} >>\nstream\n${pageContent}endstream`,
    );
    pageIds.push(
      addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,
      ),
    );
  }
  const actualPagesId = addObject(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  const catalogId = addObject(`<< /Type /Catalog /Pages ${actualPagesId} 0 R >>`);

  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const chunks: Buffer[] = [header];
  const offsets: number[] = [];
  let position = header.length;
  objects.forEach((body, index) => {
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const suffix = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(position);
    chunks.push(prefix, body, suffix);
    position += prefix.length + body.length + suffix.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
