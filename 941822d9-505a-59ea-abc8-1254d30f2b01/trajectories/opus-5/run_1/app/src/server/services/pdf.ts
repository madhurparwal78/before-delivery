import type { CertificateCopySource } from '../domain/certificateCopy.js';

/**
 * A small PDF writer over the base-14 fonts: enough for a one-page contact-hour
 * certificate, with no third-party code in the shipped tree.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;

const WINANSI_REPLACEMENTS = new Map<string, string>([
  ['\u2018', '\x91'],
  ['\u2019', '\x92'],
  ['\u201c', '\x93'],
  ['\u201d', '\x94'],
  ['\u2013', '\x96'],
  ['\u2014', '\x97'],
  ['\u2026', '\x85'],
  ['\u2022', '\x95'],
]);

function toWinAnsi(text: string): string {
  let out = '';
  for (const character of text) {
    const replacement = WINANSI_REPLACEMENTS.get(character);
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = character.codePointAt(0) ?? 63;
    out += code < 256 ? character : '?';
  }
  return out;
}

function escapePdfText(text: string): string {
  return toWinAnsi(text).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

type FontName = 'serif' | 'serifBold' | 'sans';

const FONT_RESOURCES: Record<FontName, string> = {
  serif: '/F1',
  serifBold: '/F2',
  sans: '/F3',
};

// Average glyph width as a fraction of the font size, used only for line wrapping.
const AVERAGE_WIDTH_RATIO = 0.5;

function wrap(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const perCharacter = size * (font === 'sans' ? 0.52 : AVERAGE_WIDTH_RATIO);
  const limit = Math.max(1, Math.floor(maxWidth / perCharacter));
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length > limit && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

interface TextLine {
  readonly text: string;
  readonly font: FontName;
  readonly size: number;
  readonly gapBefore: number;
}

function contentStream(lines: readonly TextLine[]): string {
  const parts: string[] = ['BT'];
  let cursor = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    cursor -= line.gapBefore + line.size;
    parts.push(`${FONT_RESOURCES[line.font]} ${line.size} Tf`);
    parts.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
    parts.push(`(${escapePdfText(line.text)}) Tj`);
  }
  parts.push('ET');
  return parts.join('\n');
}

function buildPdf(lines: readonly TextLine[]): Buffer {
  const stream = contentStream(lines);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    offset += chunk.length;
  }

  const xrefOffset = offset;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (const entry of offsets) {
    xrefLines.push(`${String(entry).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(Buffer.from(xrefLines.join(''), 'latin1'));
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}

const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** The PDF carries only the fields on the certificate-copy allow-list. */
export function renderCertificatePdf(source: CertificateCopySource): Buffer {
  const lines: TextLine[] = [];
  const push = (text: string, font: FontName, size: number, gapBefore: number): void => {
    lines.push({ text, font, size, gapBefore });
  };

  push(source.provider, 'serifBold', 22, 0);
  push('Certificate of Contact Hours', 'serif', 16, 10);
  push('Nursing continuing professional development', 'sans', 10, 2);

  push('This certifies that', 'sans', 11, 28);
  push(source.nurseName, 'serifBold', 20, 6);
  push('has completed the activity', 'sans', 11, 10);
  for (const line of wrap(source.courseTitle, 'serif', 16, CONTENT_WIDTH)) {
    push(line, 'serif', 16, 6);
  }

  push(`Contact hours awarded: ${source.contactHours}`, 'sans', 12, 24);
  push(`Serial: ${source.serial}`, 'sans', 12, 8);
  push(`Issued: ${source.issuedOn ?? 'Pending'}`, 'sans', 12, 8);
  push(`Status: ${source.state === 'revoked' ? 'Revoked' : 'Sealed'}`, 'sans', 12, 8);
  push(`Certificate version: ${source.version}`, 'sans', 12, 8);

  for (const line of wrap(source.accreditationStatement, 'sans', 10, CONTENT_WIDTH)) {
    push(line, 'sans', 10, 4);
  }

  return buildPdf(lines);
}
