/**
 * A minimal PDF writer. Page content streams and the ToUnicode CMaps are
 * uncompressed; the embedded font file uses the FlateDecode filter alone
 * (DP-33). Text is shown with Tj, so a plain extractor recovers each note
 * text exactly as typed.
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function resolveFontsDir(): string {
  const beside = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
  if (existsSync(join(beside, 'IBMPlexSans-Regular.ttf'))) return beside;
  return join(process.cwd(), 'src', 'fonts');
}
const fontsDir = resolveFontsDir();
const sansTtf = readFileSync(join(fontsDir, 'IBMPlexSans-Regular.ttf'));
const serifTtf = readFileSync(join(fontsDir, 'InstrumentSerif-Regular.ttf'));
const gidMap = JSON.parse(readFileSync(join(fontsDir, 'gidmap.json'), 'utf8')) as Record<string, Record<string, number>>;

export interface PdfPage {
  /** Lines of text, shown in order with Tj. */
  text: string[];
  /** A larger heading at the top of the page. */
  heading?: string;
}

export interface PdfDoc {
  title: string;
  pages: PdfPage[];
}

function pdfTextString(s: string): string {
  const codes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 32;
    if (cp > 0xffff) {
      codes.push(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
    } else {
      codes.push(cp);
    }
  }
  const hex = codes.map((c) => c.toString(16).padStart(4, '0')).join('');
  return `<${hex}>`;
}

/** The CIDToGIDMap stream: two bytes per CID up to 0xFFFF. */
function cidToGidStream(map: Record<string, number>): Buffer {
  const out = Buffer.alloc(0x10000 * 2);
  for (const [cp, gid] of Object.entries(map)) {
    const n = Number(cp);
    if (n >= 0 && n <= 0xffff) out.writeUInt16BE(gid, n * 2);
  }
  return out;
}

export function buildPdf(doc: PdfDoc): Buffer {
  const objects: Array<string | Buffer> = [];
  const push = (body: string | Buffer): number => {
    objects.push(body);
    return objects.length;
  };
  const streamObj = (data: Buffer, extra: string, compress = false): number => {
    if (compress) {
      const compressed = deflateSync(data);
      return push(`<< /Length ${compressed.length} /Filter /FlateDecode ${extra} >>\nstream\n${compressed.toString('latin1')}\nendstream`);
    }
    return push(`<< /Length ${data.length} ${extra} >>\nstream\n${data.toString('latin1')}\nendstream`);
  };

  const catalogId = push('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = push(''); // placeholder

  const toUnicodeId = streamObj(buildToUnicode(), '');
  const sansFontFileId = streamObj(sansTtf, `/Length1 ${sansTtf.length}`, true);
  const serifFontFileId = streamObj(serifTtf, `/Length1 ${serifTtf.length}`, true);
  const sansCidToGidId = streamObj(cidToGidStream(gidMap['IBMPlexSans-Regular.ttf'] ?? {}), '');
  const serifCidToGidId = streamObj(cidToGidStream(gidMap['InstrumentSerif-Regular.ttf'] ?? {}), '');

  const sansDescendantId = push(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /IBMPlexSans-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${objects.length + 1} 0 R /DW 1000 /CIDToGIDMap ${sansCidToGidId} 0 R >>`);
  push(`<< /Type /FontDescriptor /FontName /IBMPlexSans-Regular /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ${sansFontFileId} 0 R >>`);
  const serifDescendantId = push(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /InstrumentSerif-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${objects.length + 1} 0 R /DW 1000 /CIDToGIDMap ${serifCidToGidId} 0 R >>`);
  push(`<< /Type /FontDescriptor /FontName /InstrumentSerif-Regular /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 60 /FontFile2 ${serifFontFileId} 0 R >>`);
  const sansFontId = push(
    `<< /Type /Font /Subtype /Type0 /BaseFont /IBMPlexSans-Regular /Encoding /Identity-H /DescendantFonts ${sansDescendantId} 0 R /ToUnicode ${toUnicodeId} 0 R >>`);
  const serifFontId = push(
    `<< /Type /Font /Subtype /Type0 /BaseFont /InstrumentSerif-Regular /Encoding /Identity-H /DescendantFonts ${serifDescendantId} 0 R /ToUnicode ${toUnicodeId} 0 R >>`);

  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (const page of doc.pages) {
    contentIds.push(streamObj(buildPageContent(page), ''));
  }
  for (let i = 0; i < doc.pages.length; i++) {
    pageIds.push(push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${sansFontId} 0 R /F2 ${serifFontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`));
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const infoId = push(`<< /Title ${pdfTextString(doc.title)} /Author (Lanternfold Rooms) >>`);

  let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    const body = typeof objects[i] === 'string' ? (objects[i] as string) : (objects[i] as Buffer).toString('latin1');
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out + xref, 'latin1');
}

function buildPageContent(page: PdfPage): Buffer {
  const parts: string[] = [];
  if (page.heading) {
    parts.push('BT /F2 22 Tf 24 TL 50 764 Td');
    parts.push(`${pdfTextString(page.heading)} Tj`);
    parts.push('ET');
  }
  parts.push('BT /F1 11 Tf 16 TL 50 730 Td');
  for (const line of page.text) {
    parts.push(`T* ${pdfTextString(line)} Tj`);
  }
  parts.push('ET');
  return Buffer.from(parts.join('\n'), 'latin1');
}

function buildToUnicode(): Buffer {
  const stream = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '1 beginbfrange',
    '<0000> <FFFF> <0000>',
    'endbfrange',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  return Buffer.from(stream, 'latin1');
}
