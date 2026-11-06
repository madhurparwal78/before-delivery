// A small PDF writer with no dependency: Helvetica text, extractable by tools
// that read the page content stream. E-tickets hold the PNR, train, run date,
// From/To, class, quota, total fare and each passenger's status label.

export interface PdfLine { text: string; bold?: boolean; size?: number }

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const contents: string[] = ['BT'];
  let y = 800;
  for (const line of lines) {
    const size = line.size ?? 11;
    const font = line.bold ? '/F2' : '/F1';
    contents.push(`${font} ${size} Tf`);
    contents.push(`1 0 0 1 50 ${y} Tm`);
    contents.push(`(${esc(line.text)}) Tj`);
    y -= size + 6;
  }
  contents.push('ET');
  const stream = contents.join('\n');

  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
    '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  objs[6] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(out, 'utf8');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'utf8');
  out += `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'utf8');
}
