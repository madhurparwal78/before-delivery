/** A minimal one-font PDF writer: deterministic bytes, selectable text. */

const pageWidth = 612;
const pageHeight = 792;
const margin = 48;
const lineHeight = 14;
const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);

export type PdfLine = { text: string; bold?: boolean; size?: number };

function winAnsi(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    out += code <= 0xff ? char : '?';
  }
  return out;
}

function escapeText(text: string): string {
  return winAnsi(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(lines: PdfLine[]): string {
  let content = '';
  let y = pageHeight - margin;
  for (const line of lines) {
    const font = line.bold ? '/F2' : '/F1';
    const size = line.size ?? 10;
    content += `BT ${font} ${size} Tf 1 0 0 1 ${margin} ${y} Tm (${escapeText(line.text)}) Tj ET\n`;
    y -= lineHeight;
  }
  return content;
}

export function renderPdf(lines: PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  for (let index = 0; index < Math.max(1, lines.length); index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const firstPageObject = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(firstPageObject + index * 2);
  }

  objects[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objects[2] =
    `<</Type/Pages/Kids[${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pages.length}>>`;
  objects[3] =
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>';
  const boldFontId = firstPageObject + pages.length * 2;

  pages.forEach((pageLines, index) => {
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    const stream = contentStream(pageLines);
    objects[pageId] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageWidth} ${pageHeight}]` +
      `/Resources<</Font<</F1 3 0 R/F2 ${boldFontId} 0 R>>>>/Contents ${contentId} 0 R>>`;
    objects[contentId] = `<</Length ${Buffer.byteLength(stream, 'latin1')}>>\nstream\n${stream}endstream`;
  });
  objects[boldFontId] =
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>';

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (object === undefined) continue;
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const size = objects.length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    const offset = offsets[id];
    xref += offset === undefined
      ? '0000000000 65535 f \n'
      : `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `${xref}trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
