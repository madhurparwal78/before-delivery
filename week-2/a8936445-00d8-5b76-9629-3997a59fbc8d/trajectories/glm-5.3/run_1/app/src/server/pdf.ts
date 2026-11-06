/**
 * Minimal PDF generation for invoice PDFs and seeded document files.
 * Produces a single-page PDF with one column of lines; no third-party dependency.
 */

const escapePdfText = (s: string): string =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");

// PDF text uses WinAnsi; keep output ASCII-safe by replacing anything outside it.
const asciiSafe = (s: string): string => s.replace(/[^\x20-\x7E]/g, "?");

export interface PdfLine {
  text: string;
  size: number;
  bold?: boolean;
}

/** Build the bytes of a one-page PDF holding the given lines. */
export function buildPdf(title: string, lines: PdfLine[]): Buffer {
  const content: string[] = [];
  content.push("BT");
  let y = 780;
  content.push(`/F2 16 Tf 1 0 0 1 56 ${y} Tm (${escapePdfText(asciiSafe(title))}) Tj`);
  y -= 26;
  for (const line of lines) {
    const font = line.bold ? "/F3" : "/F2";
    content.push(`${font} ${line.size} Tf 1 0 0 1 56 ${y} Tm (${escapePdfText(asciiSafe(line.text))}) Tj`);
    y -= line.size + 6;
    if (y < 40) break;
  }
  content.push("ET");
  const stream = content.join("\n");

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F2 5 0 R /F3 6 0 R >> >> /Contents 4 0 R >>"
  );
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}
