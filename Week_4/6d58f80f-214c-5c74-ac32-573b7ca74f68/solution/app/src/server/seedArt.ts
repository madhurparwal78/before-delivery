// Seed file contents (brief: Seed data): one-page drawing sheets whose title block shows the file name, and
// procedural blueprint-style line drawings. Both are drawn here, so every seed byte is original.
import { crc32, deflateSync } from "node:zlib";

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function pdfText(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "-").replace(/([()\\])/g, "\\$1");
}

interface SheetInfo {
  title: string;
  project: string;
  sheet: string;
  date: string;
  drawnBy: string;
}

/** A landscape letter sheet: ruled border with grid references, a structural framing plan and a title block. */
export function drawingSheetPdf(info: SheetInfo): Buffer {
  const seed = hash(info.title);
  const ops: string[] = [];
  const text = (font: string, size: number, x: number, y: number, value: string) =>
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET`);
  const circle = (cx: number, cy: number, r: number) => {
    const k = r * 0.5523;
    ops.push(`${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`
      + ` ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c S`);
  };
  ops.push("0.11 0.14 0.19 RG 0.11 0.14 0.19 rg 0.6 w 18 18 756 576 re S 1.6 w 30 30 732 552 re S 0.5 w");
  const letters = "ABCDEF";
  for (let i = 0; i < 6; i++) {
    const x = 30 + (732 / 6) * (i + 0.5);
    text("F1", 7, x - 2, 22, letters[i] ?? "");
    text("F1", 7, x - 2, 586, letters[i] ?? "");
    if (i) ops.push(`${30 + (732 / 6) * i} 18 m ${30 + (732 / 6) * i} 30 l S ${30 + (732 / 6) * i} 582 m ${30 + (732 / 6) * i} 594 l S`);
  }
  for (let i = 0; i < 4; i++) {
    const y = 30 + (552 / 4) * (i + 0.5);
    text("F1", 7, 22, y - 2, String(4 - i));
    text("F1", 7, 766, y - 2, String(4 - i));
    if (i) ops.push(`18 ${30 + (552 / 4) * i} m 30 ${30 + (552 / 4) * i} l S 762 ${30 + (552 / 4) * i} m 774 ${30 + (552 / 4) * i} l S`);
  }
  const cols = 4 + (seed % 3);
  const rowsN = 3 + ((seed >> 3) % 2);
  const left = 80, right = 500, bottom = 120, top = 520;
  const xs = Array.from({ length: cols }, (_, i) => left + ((right - left) / (cols - 1)) * i);
  const ys = Array.from({ length: rowsN }, (_, i) => bottom + ((top - bottom) / (rowsN - 1)) * i);
  ops.push("0.35 w [8 3 2 3] 0 d");
  for (const x of xs) ops.push(`${x} ${bottom - 30} m ${x} ${top + 22} l S`);
  for (const y of ys) ops.push(`${left - 30} ${y} m ${right + 22} ${y} l S`);
  ops.push("[] 0 d 0.6 w");
  xs.forEach((x, i) => {
    circle(x, top + 32, 10);
    text("F2", 9, x - 3, top + 29, String(i + 1));
  });
  ys.forEach((y, i) => {
    circle(left - 40, y, 10);
    text("F2", 9, left - 43, y - 3, letters[i] ?? "");
  });
  ops.push("1.8 w");
  for (const y of ys) ops.push(`${xs[0]} ${y} m ${xs.at(-1)} ${y} l S`);
  ops.push("0.9 w");
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i] ?? 0, b = xs[i + 1] ?? 0;
    for (let j = 0; j < ys.length - 1; j++) {
      const lo = ys[j] ?? 0, hi = ys[j + 1] ?? 0;
      const joists = 3 + ((seed >> (i + j)) % 3);
      for (let k = 1; k <= joists; k++) {
        const x = a + ((b - a) / (joists + 1)) * k;
        ops.push(`${x.toFixed(1)} ${lo} m ${x.toFixed(1)} ${hi} l S`);
      }
    }
  }
  for (const x of xs) for (const y of ys) ops.push(`${x - 5} ${y - 5} 10 10 re f`);
  if (seed % 2) {
    ops.push("0.6 w [4 2] 0 d");
    for (const x of xs) for (const y of ys) ops.push(`${x - 16} ${y - 16} 32 32 re S`);
    ops.push("[] 0 d");
  }
  text("F2", 10, left - 30, 70, "FRAMING PLAN");
  ops.push(`0.6 w ${left - 30} 66 m ${left + 60} 66 l S`);
  text("F1", 7, left - 30, 56, "SCALE: 1/8\" = 1'-0\"   ALL MEMBERS PER SCHEDULE");
  ops.push("0.8 w 532 30 230 150 re S 532 150 m 762 150 l S 532 110 m 762 110 l S 532 80 m 762 80 l S 532 55 m 762 55 l S 652 30 m 652 80 l S");
  text("F2", 11, 540, 164, "LINTELWORKS");
  text("F1", 6.5, 540, 155, "STRUCTURAL ENGINEERS - TUCSON, ARIZONA");
  text("F1", 6, 540, 140, "PROJECT");
  text("F2", 8, 540, 128, info.project.slice(0, 46));
  text("F1", 6, 540, 100, "SHEET TITLE");
  const title = info.title.length > 44 ? `${info.title.slice(0, 43)}-` : info.title;
  text("F2", 8.5, 540, 88, title);
  text("F1", 6, 540, 70, "DATE");
  text("F3", 8, 540, 60, info.date);
  text("F1", 6, 660, 70, "DRAWN");
  text("F3", 8, 660, 60, info.drawnBy);
  text("F1", 6, 540, 45, "SHEET");
  text("F2", 14, 560, 34, info.sheet);
  text("F1", 6, 660, 45, "REVISION");
  text("F3", 8, 660, 36, "0");
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Title (${pdfText(info.title)}) /Producer (Lintel Drive) >>`,
  ];
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

type Rgb = [number, number, number];

class Raster {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, ground: Rgb) {
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.data.set(ground, i * 3);
  }

  dot(x: number, y: number, color: Rgb, size = 1): void {
    const half = Math.floor(size / 2);
    for (let dy = -half; dy < size - half; dy++) {
      for (let dx = -half; dx < size - half; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (px >= 0 && py >= 0 && px < this.width && py < this.height) this.data.set(color, (py * this.width + px) * 3);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, size = 1, dash = 0): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      this.dot(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, color, size);
    }
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb, size = 1, dash = 0): void {
    this.line(x, y, x + w, y, color, size, dash);
    this.line(x + w, y, x + w, y + h, color, size, dash);
    this.line(x + w, y + h, x, y + h, color, size, dash);
    this.line(x, y + h, x, y, color, size, dash);
  }

  circle(cx: number, cy: number, r: number, color: Rgb, size = 1): void {
    const steps = Math.ceil(r * 7);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      this.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, color, size);
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0;
      raw.set(this.data.subarray(y * this.width * 3, (y + 1) * this.width * 3), y * (this.width * 3 + 1) + 1);
    }
    const chunk = (kind: string, data: Buffer) => {
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length);
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(kind, "latin1"), data])));
      return Buffer.concat([head, Buffer.from(kind, "latin1"), data, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}

const BLUEPRINT: Rgb = [27, 70, 140];
const GRID: Rgb = [41, 87, 158];
const LINE: Rgb = [226, 236, 250];
const FAINT: Rgb = [128, 162, 208];

/** A blueprint line drawing: footings, a rebar mat or a site plan, chosen and varied by the file name. */
export function blueprintPng(name: string): Buffer {
  const seed = hash(name);
  const r = new Raster(720, 480, BLUEPRINT);
  for (let x = 0; x < 720; x += 24) r.line(x, 0, x, 479, GRID);
  for (let y = 0; y < 480; y += 24) r.line(0, y, 719, y, GRID);
  r.rect(12, 12, 696, 456, LINE, 2);
  r.rect(470, 400, 226, 56, LINE, 1);
  r.line(470, 428, 696, 428, LINE);
  for (let i = 0; i < 9; i++) r.line(480 + i * 22, 410, 492 + i * 22, 410, FAINT, 2);
  r.line(480, 442, 600, 442, FAINT, 2);
  r.circle(650, 70, 26, LINE, 2);
  r.line(650, 96, 650, 44, LINE, 2);
  r.line(650, 44, 640, 62, LINE, 2);
  r.line(650, 44, 660, 62, LINE, 2);
  if (/rebar/i.test(name)) {
    r.rect(60, 60, 380, 300, LINE, 2);
    for (let x = 72; x < 440; x += 14) r.line(x, 64, x, 356, LINE);
    for (let y = 72; y < 360; y += 14) r.line(64, y, 436, y, LINE);
    for (let i = 0; i < 12; i++) r.circle(86 + ((seed >> i) % 24) * 14, 86 + ((seed >> (i + 5)) % 18) * 14, 5, LINE, 2);
    r.circle(520, 230, 46, LINE, 2);
    r.line(440, 210, 474, 222, LINE, 1, 6);
    for (let x = 486; x < 556; x += 12) r.circle(x, 230, 4, LINE, 2);
  } else if (/footing/i.test(name)) {
    const cols = 3 + (seed % 2);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < 2; j++) {
        const x = 80 + i * (360 / cols), y = 90 + j * 160;
        r.rect(x, y, 84, 84, LINE, 2);
        r.rect(x + 28, y + 28, 28, 28, LINE, 2);
        for (let k = 0; k < 84; k += 10) r.line(x + k, y + 84, x + Math.min(84, k + 84), y + Math.max(0, 84 - (84 - k)), FAINT);
        r.line(x - 10, y + 100, x + 94, y + 100, FAINT, 1, 4);
      }
    }
    r.line(60, 420, 420, 420, LINE);
    for (let x = 60; x <= 420; x += 90) r.line(x, 412, x, 428, LINE);
  } else {
    const pts: [number, number][] = [[70, 80], [430, 60], [450, 330], [90, 370]];
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length] ?? [x, y];
      r.line(x, y, nx, ny, LINE, 2, 10);
    });
    r.rect(170, 150, 170 + (seed % 40), 110, LINE, 3);
    for (let c = 0; c < 5; c++) {
      let px = 40, py = 120 + c * 60;
      for (let x = 40; x < 690; x += 6) {
        const y = 120 + c * 60 + Math.sin((x + (seed % 97)) / (55 + c * 9)) * (14 + c * 3);
        r.line(px, py, x, y, FAINT);
        px = x;
        py = y;
      }
    }
  }
  return r.png();
}
