import { deflateSync } from "node:zlib";
import { monDYyyy } from "../domain/time.js";

// Writes the certificate PDF (US Letter, landscape) with the standard PDF fonts and a drawn seal.

interface CertificateCopy {
  providerName: string;
  accreditationStatement: string;
  nurseName: string;
  courseTitle: string;
  contactHours: string;
  serial: string;
  issuedOn: string;
  version: number;
}

const INK = "0.090 0.129 0.110";
const MUTED = "0.310 0.369 0.337";
const RULE = "0.824 0.820 0.780";
const PAPER = "0.965 0.949 0.910";
const TERRACOTTA = "0.706 0.325 0.180";
const TERRA_DEEP = "0.541 0.227 0.114";

/** PDF literal string in WinAnsi: Latin-1 bytes, anything wider becomes "?". */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const safe = code > 255 ? "?" : ch;
    out += safe === "\\" || safe === "(" || safe === ")" ? `\\${safe}` : safe;
  }
  return `(${out})`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const text = (font: string, size: number, x: number, y: number, value: string, color: string): string =>
  `BT ${color} rg /${font} ${size} Tf ${x} ${y} Td ${literal(value)} Tj ET`;

/** A circle as four Bézier arcs. */
function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  return [
    `${cx + r} ${cy} m`,
    `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c`,
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`,
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c`,
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c`,
  ].join(" ");
}

function content(copy: CertificateCopy): string {
  const ops: string[] = [
    `${PAPER} rg 0 0 792 612 re f`,
    `${INK} RG 1.2 w 36 36 720 540 re S`,
    `${RULE} RG 0.6 w 44 44 704 524 re S`,
    text("F4", 15, 72, 522, copy.providerName, INK),
    text("F1", 9, 72, 504, "CERTIFICATE OF COMPLETION  ·  CONTINUING PROFESSIONAL DEVELOPMENT", MUTED),
    `${RULE} RG 0.6 w 72 490 m 520 490 l S`,
    text("F1", 12, 72, 452, "This certifies that", MUTED),
  ];
  const nameLines = wrap(copy.nurseName, 30);
  let y = 416;
  for (const line of nameLines) {
    ops.push(text("F4", 30, 72, y, line, INK));
    y -= 34;
  }
  ops.push(text("F1", 12, 72, y - 2, "completed the continuing professional development activity", MUTED));
  y -= 36;
  for (const line of wrap(copy.courseTitle, 40)) {
    ops.push(text("F3", 22, 72, y, line, INK));
    y -= 26;
  }
  ops.push(text("F1", 12, 72, y - 4, `and was awarded ${copy.contactHours} contact hours.`, INK));

  const details: [string, string][] = [
    ["SERIAL", copy.serial],
    ["ISSUED", monDYyyy(copy.issuedOn)],
    ["VERSION", String(copy.version)],
  ];
  ops.push(`${RULE} RG 0.6 w 72 196 m 520 196 l S`);
  details.forEach(([label, value], index) => {
    const x = 72 + index * 160;
    ops.push(text("F1", 8, x, 178, label, MUTED), text("F2", 12, x, 160, value, INK));
  });
  wrap(copy.accreditationStatement, 96).forEach((line, index) => ops.push(text("F1", 9, 72, 112 - index * 13, line, MUTED)));

  // The seal: thin outer ring, solid terracotta field, paper centre with the awarded hours.
  const [cx, cy] = [628, 352];
  ops.push(
    `${TERRACOTTA} RG 1.5 w ${circle(cx, cy, 96)} S`,
    `${TERRACOTTA} rg ${circle(cx, cy, 78)} f`,
    `${PAPER} rg ${circle(cx, cy, 40)} f`,
    `${TERRACOTTA} RG 0.8 w ${circle(cx, cy, 40)} S`,
  );
  const numeralWidth = [...copy.contactHours].reduce((sum, ch) => sum + (ch === "." ? 0.25 : 0.5), 0) * 26;
  ops.push(text("F4", 26, cx - numeralWidth / 2, cy - 6, copy.contactHours, TERRA_DEEP));
  ops.push(text("F2", 6.5, cx - 22, cy - 20, "CONTACT HOURS", TERRA_DEEP));
  ops.push(text("F2", 8, cx - 38, cy - 116, copy.serial, TERRA_DEEP));
  return ops.join("\n");
}

export function certificatePdf(copy: CertificateCopy): Buffer {
  const stream = deflateSync(Buffer.from(content(copy), "latin1"));
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >> /Contents 8 0 R >>"),
    ...["Helvetica", "Helvetica-Bold", "Times-Roman", "Times-Bold"].map((font) =>
      Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`),
    ),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    Buffer.from(`<< /Title ${literal(`${copy.serial} v${copy.version}`)} /Producer (Credwell) >>`, "latin1"),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let size = chunks[0]?.length ?? 0;
  objects.forEach((body, index) => {
    offsets.push(size);
    const piece = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(piece);
    size += piece.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
