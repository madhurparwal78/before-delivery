import type { Schedule } from '../domain/schedule.js';

const PAGE_WIDTH = 842; // A4 landscape, in points
const PAGE_HEIGHT = 595;
const ROWS_PER_PAGE = 20;
const LEFT = 40;

function escapeLiteral(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

function pdfString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return `(${escapeLiteral(value)})`;
  const utf16 = Buffer.from(`\ufeff${value}`, 'utf16le');
  for (let i = 0; i < utf16.length; i += 2) {
    const low = utf16[i];
    utf16[i] = utf16[i + 1];
    utf16[i + 1] = low;
  }
  return `<${utf16.toString('hex')}>`;
}

function textOp(x: number, y: number, size: number, value: string): string {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapeLiteral(value)}) Tj ET\n`;
}

export function rowLine(row: number, name: string, start: string | null, end: string | null, duration: number, percent: number): string {
  return [String(row), name, start ?? '', end ?? '', String(duration), `${percent}%`]
    .filter((part) => part !== '')
    .join(' ');
}

export function renderPdf(projectName: string, schedule: Schedule): Buffer {
  const pageCount = Math.max(1, Math.ceil(schedule.items.length / ROWS_PER_PAGE));
  const contents: string[] = [];

  for (let page = 0; page < pageCount; page += 1) {
    const rows = schedule.items.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
    let stream = textOp(LEFT, PAGE_HEIGHT - 48, 14, projectName);
    rows.forEach((item, index) => {
      stream += textOp(
        LEFT,
        PAGE_HEIGHT - 86 - index * 22,
        10,
        rowLine(item.row, item.name, item.start, item.end, item.duration, item.percent),
      );
    });
    stream += textOp(LEFT, 36, 10, `Page ${page + 1} of ${pageCount}`);
    contents.push(stream);
  }

  const objects: string[] = [];
  const firstPageObject = 4;
  const pageIds = contents.map((_, index) => firstPageObject + index * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  contents.forEach((stream, index) => {
    const pageId = pageIds[index];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  });

  const infoId = firstPageObject + contents.length * 2;
  objects[infoId] = `<< /Title ${pdfString(projectName)} /Producer (Slackwater Plan) >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}
