// A small single-page PDF writer for invoice PDFs and the seeded compliance documents.

export interface PdfText {
  text: string;
  x: number;
  y: number;
  size: number;
  bold?: boolean;
}

export interface PdfRule {
  x1: number;
  x2: number;
  y: number;
}

function escape(text: string): string {
  return [...text]
    .map((ch) => (ch.charCodeAt(0) > 0xff ? "-" : ch))
    .join("")
    .replace(/[\\()]/g, (ch) => `\\${ch}`);
}

export function renderPdf(texts: PdfText[], rules: PdfRule[] = []): Buffer {
  const content = [
    ...rules.map((r) => `0.5 w ${r.x1} ${r.y} m ${r.x2} ${r.y} l S`),
    ...texts.map((t) => `BT /${t.bold ? "F2" : "F1"} ${t.size} Tf ${t.x} ${t.y} Td (${escape(t.text)}) Tj ET`),
  ].join("\n");
  const stream = Buffer.from(content, "latin1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`,
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
