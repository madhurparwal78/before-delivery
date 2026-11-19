const escape = (text: string): string => text.replace(/([\\()])/g, '\\$1');

const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `${x1} ${y1} m ${x2} ${y2} l S\n`;

/** A one-page drawing sheet whose title block shows the file name. */
export const drawingSheetPdf = (fileName: string, project: string): Buffer => {
  const width = 842;
  const height = 595;
  let content = '0.15 0.18 0.22 RG\n1 w\n';
  content += `${20} ${20} ${width - 40} ${height - 40} re S\n`;
  content += `${32} ${32} ${width - 64} ${height - 64} re S\n`;

  const blockWidth = 300;
  const blockHeight = 110;
  const blockX = width - 32 - blockWidth;
  const blockY = 32;
  content += `${blockX} ${blockY} ${blockWidth} ${blockHeight} re S\n`;
  content += line(blockX, blockY + 38, blockX + blockWidth, blockY + 38);
  content += line(blockX, blockY + 74, blockX + blockWidth, blockY + 74);

  content += '0.5 w\n0.55 0.62 0.70 RG\n';
  for (let x = 80; x < blockX - 20; x += 40) content += line(x, 120, x, height - 120);
  for (let y = 120; y < height - 120; y += 40) content += line(80, y, blockX - 20, y);
  content += '1.4 w\n0.15 0.18 0.22 RG\n';
  content += line(120, 180, 420, 180);
  content += line(120, 180, 120, 420);
  content += line(120, 420, 420, 420);
  content += line(420, 180, 420, 420);
  content += line(120, 180, 420, 420);

  content += 'BT /F1 13 Tf ';
  content += `${blockX + 10} ${blockY + 84} Td (${escape(fileName)}) Tj ET\n`;
  content += 'BT /F1 9 Tf ';
  content += `${blockX + 10} ${blockY + 50} Td (${escape(project)}) Tj ET\n`;
  content += 'BT /F1 9 Tf ';
  content += `${blockX + 10} ${blockY + 14} Td (Lintelworks \\267 Structural Engineering \\267 Tucson) Tj ET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};
