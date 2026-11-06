import { formatMoney } from '../../shared/format';
import { formatPacificDateTime } from '../../shared/pacific';
import { tierLabel, type Tier } from '../../shared/labels';

export interface ReportSample {
  colonyLabel: string;
  framesText: string;
}

export interface ReportBlock {
  name: string;
  hivesDelivered: number;
  averageText: string | null;
  tier: Tier | null;
  payableCents: number;
  samples: ReportSample[];
}

export interface ReportData {
  orchardName: string;
  county: string;
  orderRef: string;
  blocks: ReportBlock[];
  payableCents: number;
  inspectorName: string;
  signedAt: Date;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 11;
const LINE_HEIGHT = 16;

interface Line {
  text: string;
  size: number;
  bold: boolean;
  indent: number;
}

function line(text: string, size = BODY_SIZE, bold = false, indent = 0): Line {
  return { text, size, bold, indent };
}

function reportLines(data: ReportData): Line[] {
  const lines: Line[] = [
    line('Swarmline Bloom Desk — Inspection Report', 18, true),
    line(`${data.orchardName}, ${data.county} County`, 13, true),
    line(`Order ${data.orderRef}`),
    line(''),
  ];
  for (const block of data.blocks) {
    const strength =
      block.averageText === null
        ? 'no samples'
        : `${block.averageText} frames average, ${tierLabel(block.tier)}`;
    lines.push(line(`${block.name} — ${block.hivesDelivered} hives delivered`, 13, true));
    lines.push(line(`Strength: ${strength}`, BODY_SIZE, false, 12));
    lines.push(line(`Payable: ${formatMoney(block.payableCents)}`, BODY_SIZE, false, 12));
    if (block.samples.length === 0) {
      lines.push(line('Samples: none', BODY_SIZE, false, 12));
    } else {
      lines.push(line('Samples:', BODY_SIZE, false, 12));
      for (const sample of block.samples) {
        lines.push(
          line(`Colony ${sample.colonyLabel}: ${sample.framesText} frames`, BODY_SIZE, false, 24),
        );
      }
    }
    lines.push(line(''));
  }
  lines.push(line(`Orchard payable: ${formatMoney(data.payableCents)}`, 13, true));
  lines.push(line(''));
  lines.push(line(`Signed by ${data.inspectorName}`));
  lines.push(line(`${formatPacificDateTime(data.signedAt)} Pacific`));
  return lines;
}

function escapeText(value: string): string {
  let mapped = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 63;
    mapped += code > 0xff ? '?' : character;
  }
  return mapped.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function paginate(lines: readonly Line[]): Line[][] {
  const perPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
  const pages: Line[][] = [];
  for (let index = 0; index < lines.length; index += perPage) {
    pages.push(lines.slice(index, index + perPage));
  }
  return pages.length === 0 ? [[]] : pages;
}

function pageContent(lines: readonly Line[]): string {
  let cursor = PAGE_HEIGHT - MARGIN;
  let stream = '';
  for (const entry of lines) {
    if (entry.text.length > 0) {
      stream += `BT /${entry.bold ? 'F2' : 'F1'} ${entry.size} Tf 1 0 0 1 ${MARGIN + entry.indent} ${cursor} Tm (${escapeText(entry.text)}) Tj ET\n`;
    }
    cursor -= LINE_HEIGHT;
  }
  return stream;
}

/** A self-contained PDF of the signed inspection report. */
export function renderInspectionReportPdf(data: ReportData): Buffer {
  const pages = paginate(reportLines(data));
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const fontBoldId = 3 + pages.length * 2 + 1;
  pages.forEach((linesOnPage, index) => {
    const contentId = pageObjectIds[index] as number;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId + 1} 0 R >>`,
    );
    const stream = pageContent(linesOnPage);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  });
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
