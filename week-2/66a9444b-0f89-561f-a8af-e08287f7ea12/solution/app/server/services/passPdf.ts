// A pass PDF: holder, item, time or festival day, venue and pass code, plus a QR code that encodes only the
// pass code. Text streams stay uncompressed so the printed words appear in the file bytes.
import qrcode from "qrcode-generator";

export type PassFace = { holder: string; item: string; when: string; venue: string; code: string };

const WIDTH = 420;
const HEIGHT = 640;
const WIN_ANSI: Record<string, number> = { "€": 0x80, "–": 0x96, "—": 0x97, "·": 0xb7, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "…": 0x85 };

function pdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.codePointAt(0)!;
    const byte = code <= 0xff ? code : 0x3f;
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? "\\" + c : c;
  }
  return `(${out})`;
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function passPdf(face: PassFace): Buffer {
  const ops: string[] = [];
  // Ink header band and a lime rule: the festival's colours, no words beyond the pass face.
  ops.push("0.055 0.055 0.063 rg", `0 ${HEIGHT - 120} ${WIDTH} 120 re f`, "0.784 0.941 0.192 rg", `0 ${HEIGHT - 128} ${WIDTH} 8 re f`);
  const label = (y: number, text: string) => ops.push("0.35 0.35 0.38 rg", "BT", "/F1 9 Tf", `32 ${y} Td`, `${pdfText(text)} Tj`, "ET");
  const value = (y: number, text: string, size: number) => {
    let line = y;
    for (const part of wrap(text, Math.floor(560 / size))) {
      ops.push("0.055 0.055 0.063 rg", "BT", `/F2 ${size} Tf`, `32 ${line} Td`, `${pdfText(part)} Tj`, "ET");
      line -= size * 1.2;
    }
  };
  ops.push("0.784 0.941 0.192 rg", "BT", "/F2 26 Tf", `32 ${HEIGHT - 70} Td`, `${pdfText(face.item.length > 26 ? face.item.slice(0, 25) + "…" : face.item)} Tj`, "ET");
  label(HEIGHT - 160, "HOLDER");
  value(HEIGHT - 180, face.holder, 18);
  label(HEIGHT - 222, "ITEM");
  value(HEIGHT - 240, face.item, 14);
  label(HEIGHT - 282, "WHEN");
  value(HEIGHT - 300, face.when, 14);
  label(HEIGHT - 342, "VENUE");
  value(HEIGHT - 360, face.venue, 14);

  const qr = qrcode(0, "M");
  qr.addData(face.code);
  qr.make();
  const modules = qr.getModuleCount();
  const size = 170;
  const cell = size / (modules + 8);
  const x0 = 32;
  const y0 = 60;
  ops.push("1 1 1 rg", `${x0} ${y0} ${size} ${size} re f`, "0.055 0.055 0.063 rg");
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (qr.isDark(r, c)) ops.push(`${(x0 + (c + 4) * cell).toFixed(2)} ${(y0 + size - (r + 5) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
    }
  }
  label(250, "PASS");
  ops.push("0.055 0.055 0.063 rg", "BT", "/F3 16 Tf", `${x0 + size + 20} ${y0 + 80} Td`, `${pdfText(face.code)} Tj`, "ET");

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
