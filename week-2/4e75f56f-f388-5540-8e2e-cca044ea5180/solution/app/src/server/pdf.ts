// A minimal single-page PDF writer: text lines in the standard Times and Helvetica faces, so
// receipts, letters and certificates are real, extractable text.

export interface PdfLine {
  text: string;
  size?: number;
  font?: "title" | "body" | "bold";
  gap?: number;
}

const FONTS = { title: "/F1", body: "/F2", bold: "/F3" } as const;

function escape(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, (c) => (c === "–" || c === "—" ? "-" : ""))
    .replace(/[\\()]/g, (c) => `\\${c}`);
}

export function renderPdf(lines: readonly PdfLine[]): Buffer {
  let y = 760;
  const ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= line.gap ?? size * 1.5;
    ops.push(`BT ${FONTS[line.font ?? "body"]} ${size} Tf 64 ${Math.round(y)} Td (${escape(line.text)}) Tj ET`);
  }
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
