import { shape, textWidth, type TrueTypeFont } from './truetype.js';

/**
 * A small PDF writer built for the recap's text layer:
 *
 * - every page content stream and every ToUnicode CMap is written uncompressed, so no filter
 *   other than FlateDecode is ever involved
 * - each embedded font carries a ToUnicode CMap mapping every shown code to its Unicode text
 * - text is shown with the standard `Tj` operator
 *
 * A plain extractor that reads those streams in order therefore recovers each note text.
 */

interface PdfObject {
  readonly id: number;
  readonly body: Buffer;
}

class ObjectTable {
  private readonly objects: PdfObject[] = [];
  private nextId = 1;

  reserve(): number {
    return this.nextId++;
  }

  put(id: number, body: string | Buffer): number {
    this.objects.push({ id, body: typeof body === 'string' ? Buffer.from(body, 'latin1') : body });
    return id;
  }

  add(body: string | Buffer): number {
    return this.put(this.reserve(), body);
  }

  stream(dictionary: string, data: Buffer): number {
    const header = Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, 'latin1');
    const footer = Buffer.from('\nendstream', 'latin1');
    return this.add(Buffer.concat([header, data, footer]));
  }

  render(catalogId: number, infoId: number): Buffer {
    const pieces: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let position = pieces[0]?.length ?? 0;
    const offsets = new Map<number, number>();
    const ordered = [...this.objects].sort((left, right) => left.id - right.id);
    for (const object of ordered) {
      offsets.set(object.id, position);
      const chunk = Buffer.concat([
        Buffer.from(`${object.id} 0 obj\n`, 'latin1'),
        object.body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      pieces.push(chunk);
      position += chunk.length;
    }
    const size = this.nextId;
    const xrefLines = ['xref', `0 ${size}`, '0000000000 65535 f '];
    for (let id = 1; id < size; id += 1) {
      const offset = offsets.get(id);
      xrefLines.push(offset === undefined ? '0000000000 65535 f ' : `${String(offset).padStart(10, '0')} 00000 n `);
    }
    const trailer = `${xrefLines.join('\n')}\ntrailer\n<< /Size ${size} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${position}\n%%EOF\n`;
    pieces.push(Buffer.from(trailer, 'latin1'));
    return Buffer.concat(pieces);
  }
}

function pdfString(value: string): string {
  // UTF-16BE with a byte-order mark covers every character a title may hold.
  const utf16 = Buffer.from(`\ufeff${value}`, 'utf16le');
  for (let index = 0; index < utf16.length; index += 2) {
    const low = utf16[index] as number;
    utf16[index] = utf16[index + 1] as number;
    utf16[index + 1] = low;
  }
  return `<${utf16.toString('hex')}>`;
}

export interface EmbeddedFont {
  readonly resourceName: string;
  readonly font: TrueTypeFont;
}

class FontUse {
  readonly glyphs = new Map<number, number>();

  constructor(readonly embedded: EmbeddedFont) {}

  record(glyphs: readonly number[], codePoints: readonly number[]): void {
    for (let index = 0; index < glyphs.length; index += 1) {
      this.glyphs.set(glyphs[index] as number, codePoints[index] as number);
    }
  }
}

export interface TextRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fontName: string;
}

export interface RectangleRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: readonly [number, number, number] | null;
  readonly stroke: readonly [number, number, number] | null;
}

export interface PdfPage {
  readonly width: number;
  readonly height: number;
  readonly rectangles: readonly RectangleRun[];
  readonly texts: readonly TextRun[];
}

export interface PdfDocument {
  /** Becomes the document's Title; the Author is fixed. */
  readonly title: string;
  readonly pages: readonly PdfPage[];
  readonly fonts: readonly EmbeddedFont[];
}

export const PDF_AUTHOR = 'Lanternfold Rooms';

function colourOperator(colour: readonly [number, number, number], stroke: boolean): string {
  const operator = stroke ? 'RG' : 'rg';
  return `${colour.map((channel) => channel.toFixed(3)).join(' ')} ${operator}`;
}

function buildContentStream(page: PdfPage, uses: Map<string, FontUse>): Buffer {
  const lines: string[] = [];
  for (const rectangle of page.rectangles) {
    lines.push('q');
    if (rectangle.fill) lines.push(colourOperator(rectangle.fill, false));
    if (rectangle.stroke) lines.push(colourOperator(rectangle.stroke, true), '0.8 w');
    lines.push(
      `${rectangle.x.toFixed(2)} ${rectangle.y.toFixed(2)} ${rectangle.width.toFixed(2)} ${rectangle.height.toFixed(2)} re`,
    );
    if (rectangle.fill && rectangle.stroke) lines.push('B');
    else if (rectangle.fill) lines.push('f');
    else lines.push('S');
    lines.push('Q');
  }
  for (const run of page.texts) {
    const use = uses.get(run.fontName);
    if (!use) continue;
    const shaped = shape(use.embedded.font, run.text);
    if (shaped.glyphs.length === 0) continue;
    use.record(shaped.glyphs, shaped.codePoints);
    const hex = shaped.glyphs.map((glyph) => glyph.toString(16).padStart(4, '0')).join('');
    lines.push(
      'BT',
      '0.09 0.08 0.07 rg',
      `/${run.fontName} ${run.size.toFixed(2)} Tf`,
      `1 0 0 1 ${run.x.toFixed(2)} ${run.y.toFixed(2)} Tm`,
      `<${hex}> Tj`,
      'ET',
    );
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'latin1');
}

function toUnicodeCMap(use: FontUse): Buffer {
  const entries = [...use.glyphs.entries()].sort(([left], [right]) => left - right);
  const chunks: string[] = [];
  for (let index = 0; index < entries.length; index += 100) {
    const slice = entries.slice(index, index + 100);
    chunks.push(
      `${slice.length} beginbfchar`,
      ...slice.map(([glyph, codePoint]) => {
        const target = Buffer.from(String.fromCodePoint(codePoint), 'utf16le');
        for (let byte = 0; byte < target.length; byte += 2) {
          const low = target[byte] as number;
          target[byte] = target[byte + 1] as number;
          target[byte + 1] = low;
        }
        return `<${glyph.toString(16).padStart(4, '0')}> <${target.toString('hex')}>`;
      }),
      'endbfchar',
    );
  }
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
  return Buffer.from(cmap, 'latin1');
}

function widthArray(use: FontUse): string {
  const glyphs = [...use.glyphs.keys()].sort((left, right) => left - right);
  const parts: string[] = [];
  for (const glyph of glyphs) {
    parts.push(`${glyph} [${use.embedded.font.widthFor(glyph)}]`);
  }
  return parts.join(' ');
}

export function renderPdf(document: PdfDocument): Buffer {
  const table = new ObjectTable();
  const catalogId = table.reserve();
  const pagesId = table.reserve();
  const infoId = table.reserve();

  const uses = new Map<string, FontUse>();
  for (const font of document.fonts) uses.set(font.resourceName, new FontUse(font));

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const page of document.pages) {
    const content = buildContentStream(page, uses);
    contentIds.push(table.stream('', content));
    pageIds.push(table.reserve());
  }

  // Fonts are written after the pages so every glyph a page used is known.
  const fontIds = new Map<string, number>();
  for (const [name, use] of uses) {
    const fileId = table.stream(
      `/Length1 ${use.embedded.font.bytes.length}`,
      use.embedded.font.bytes,
    );
    const descriptorId = table.add(
      `<< /Type /FontDescriptor /FontName /${use.embedded.font.postScriptName} /Flags 4 ` +
        `/FontBBox [-1000 -400 2000 1100] /ItalicAngle 0 /Ascent 900 /Descent -200 ` +
        `/CapHeight 700 /StemV 80 /FontFile2 ${fileId} 0 R >>`,
    );
    const cidFontId = table.add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${use.embedded.font.postScriptName} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${descriptorId} 0 R /DW 600 /W [ ${widthArray(use)} ] /CIDToGIDMap /Identity >>`,
    );
    const toUnicodeId = table.stream('', toUnicodeCMap(use));
    fontIds.set(
      name,
      table.add(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${use.embedded.font.postScriptName} ` +
          `/Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
      ),
    );
  }

  const fontResources = [...fontIds.entries()].map(([name, id]) => `/${name} ${id} 0 R`).join(' ');
  for (let index = 0; index < document.pages.length; index += 1) {
    const page = document.pages[index] as PdfPage;
    table.put(
      pageIds[index] as number,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] ` +
        `/Resources << /Font << ${fontResources} >> >> /Contents ${contentIds[index]} 0 R >>`,
    );
  }

  table.put(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  table.put(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  // The document carries a Title and an Author, and no other metadata.
  table.put(infoId, `<< /Title ${pdfString(document.title)} /Author ${pdfString(PDF_AUTHOR)} >>`);

  return table.render(catalogId, infoId);
}

/** Breaks text into lines that fit `maxWidth`, measured in the embedded font. */
export function wrapText(
  font: TrueTypeFont,
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (textWidth(font, candidate, size) <= maxWidth || current === '') {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) return lines;
  }
  if (current !== '' && lines.length < maxLines) lines.push(current);
  return lines;
}
