import { crc32, deflateSync } from "node:zlib";

// Documents the app draws itself: one-page PDFs (invoices, the seeded palette sheet) and PNGs.

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  size: number;
  font?: "regular" | "bold" | "mono";
  align?: "left" | "right";
}

interface PdfRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rgb?: [number, number, number];
  width?: number;
}

interface PdfBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: [number, number, number];
}

/** WinAnsi text: Latin-1 characters map one to one; anything else becomes "?". */
function pdfText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 32 && code < 127) out += char;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else if (char === "–" || char === "—") out += "-";
    else out += "?";
  }
  return out;
}

const WIDTH = { regular: 0.5, bold: 0.55, mono: 0.6 } as const;

export function renderPdf(content: { lines: PdfLine[]; rules?: PdfRule[]; boxes?: PdfBox[] }): Buffer {
  const ops: string[] = [];
  for (const box of content.boxes ?? []) {
    ops.push(`${box.rgb.map((c) => (c / 255).toFixed(3)).join(" ")} rg ${box.x} ${box.y} ${box.w} ${box.h} re f`);
  }
  for (const rule of content.rules ?? []) {
    const rgb = (rule.rgb ?? [26, 29, 38]).map((c) => (c / 255).toFixed(3)).join(" ");
    ops.push(`${rgb} RG ${rule.width ?? 0.6} w ${rule.x1} ${rule.y1} m ${rule.x2} ${rule.y2} l S`);
  }
  for (const line of content.lines) {
    const font = line.font ?? "regular";
    const resource = font === "bold" ? "F2" : font === "mono" ? "F3" : "F1";
    const width = [...line.text].length * line.size * WIDTH[font];
    const x = line.align === "right" ? line.x - width : line.x;
    ops.push(`BT 0.102 0.114 0.149 rg /${resource} ${line.size} Tf ${x.toFixed(2)} ${line.y} Td (${pdfText(line.text)}) Tj ET`);
  }
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** An RGB PNG from a pixel function. */
export function renderPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
