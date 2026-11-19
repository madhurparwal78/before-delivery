/** A minimal PDF writer: one page, standard Helvetica text, extractable. */
export function buildPdf(lines: string[]): Buffer {
  const escape = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let text = '';
  let y = 780;
  for (const line of lines) {
    for (const chunk of wrap(line)) {
      text += `BT /F1 11 Tf 48 ${y} Td (${escape(chunk)}) Tj ET\n`;
      y -= 16;
    }
    y -= 4;
  }
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  const streamLength = Buffer.byteLength(text, 'latin1');
  objects.push(`<< /Length ${streamLength} >>\nstream\n${text}endstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function wrap(text: string): string[] {
  const max = 92;
  if (text.length <= max) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if ((current + ' ' + word).length <= max) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
