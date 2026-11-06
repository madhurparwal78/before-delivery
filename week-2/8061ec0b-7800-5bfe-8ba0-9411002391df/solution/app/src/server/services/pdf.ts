// A minimal one-page PDF writer: Helvetica text in an uncompressed content stream, so every word stays readable.

export interface PdfLine { text: string; size?: number; bold?: boolean; gap?: number }

/** WinAnsi literal string: escapes ( ) \ and writes characters outside ASCII as octal bytes. */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return `(${out})`;
}

export function renderPdf(title: string, lines: readonly PdfLine[]): Buffer {
  let y = 760;
  const content = [`BT /F2 18 Tf 56 ${y} Td ${literal(title)} Tj ET`];
  y -= 34;
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= line.gap ?? 0;
    content.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf 56 ${y} Td ${literal(line.text)} Tj ET`);
    y -= Math.round(size * 1.55);
  }
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
