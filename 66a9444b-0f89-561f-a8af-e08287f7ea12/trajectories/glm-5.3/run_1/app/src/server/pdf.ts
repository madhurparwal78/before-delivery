import qrcodegen from "qrcode-generator";

export interface PassPdfContent {
  holderName: string;
  itemTitle: string;
  when: string; // session time or festival day, already formatted
  venue: string;
  passCode: string;
}

// Standard-font PDF text is WinAnsi; keep pass text unambiguous by
// transliterating to characters the encoding carries.
function pdfText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00b7/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

function escapePdfText(s: string): string {
  return pdfText(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// A minimal PDF writer: one page, Helvetica text, a QR drawn as filled squares.
// Content streams are stored uncompressed so the printed words appear in the file bytes.
export function buildPassPdf(content: PassPdfContent): Buffer {
  const pageW = 400;
  const pageH = 250;
  const qr = qrcodegen(0, "M");
  qr.addData(content.passCode);
  qr.make();
  const modules = qr.getModuleCount();
  const cell = 3.2;
  const qrSize = modules * cell;
  const qrX = pageW - qrSize - 32;
  const qrY = 60;

  const parts: string[] = [];
  parts.push("0.85 0.9 0.5 rg");
  parts.push(`0 ${pageH - 46} ${pageW} 46 re f`);
  parts.push("0 0 0 rg");
  const lines: Array<[string, number]> = [
    [`Kerf Frequencies pass`, 24],
    [content.itemTitle, 15],
    [content.holderName, 12],
    [content.when, 11],
    [content.venue, 11],
    [content.passCode, 11],
  ];
  let y = pageH - 30;
  for (const [text, size] of lines) {
    parts.push(`BT /F1 ${size} Tf 24 ${y} Td (${escapePdfText(text)}) Tj ET`);
    y -= size + 8;
  }
  // QR code: only the pass code, drawn as dark modules.
  parts.push("0 0 0 rg");
  for (let r = 0; r < modules; r += 1) {
    for (let c = 0; c < modules; c += 1) {
      if (qr.isDark(r, c)) {
        parts.push(`${(qrX + c * cell).toFixed(2)} ${(qrY + (modules - 1 - r) * cell).toFixed(2)} ${cell} ${cell} re f`);
      }
    }
  }
  const stream = parts.join("\n");

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(out, "utf8"));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, "utf8");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, "utf8");
}
