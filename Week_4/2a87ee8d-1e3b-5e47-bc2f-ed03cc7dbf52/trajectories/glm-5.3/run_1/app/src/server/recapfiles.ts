/**
 * Recap file generation: the notes CSV (DP-35), the board PDF (DP-33) with an
 * extractable text layer, and one PNG per frame. Private content never appears
 * here (DP-58): these functions only receive included notes.
 */
import { deflateSync } from 'node:zlib';

/** CSV cell rule (DP-35): cells starting with =, +, -, @, tab or CR are made inert. */
export function csvCell(value: string): string {
  const first = value.slice(0, 1);
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return `'${value}`;
  }
  const quoted = /["\r\n,]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return quoted ? `"${escaped}"` : escaped;
}

export interface CsvRow { frame: string; cluster: string; note: string; clusterDots: number }

/** UTF-8 without a BOM, CRLF endings, RFC 4180 quoting. */
export function buildCsv(rows: CsvRow[]): Buffer {
  const lines: string[] = ['frame,cluster,note,cluster_dots'];
  for (const r of rows) {
    lines.push([csvCell(r.frame), csvCell(r.cluster), csvCell(r.note), String(r.clusterDots)].join(','));
  }
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
}

// ---- PNG encoding (no dependencies): a minimal encoder with uncompressed blocks

export interface Rgb { r: number; g: number; b: number }

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode RGBA scanlines (filter 0) into a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4)
      .forEach((v, i) => { raw[y * (width * 4 + 1) + 1 + i] = v; });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface PngNote { text: string | null; x: number; y: number; cluster: string | null }

/** Draw one frame as a PNG: title, clusters, notes as stickies (DP-33). */
export function framePng(frameTitle: string, width: number, height: number, scale: number, notes: PngNote[], dotTotals: Map<string, number>): Buffer {
  const w = Math.max(600, Math.round(width * scale));
  const h = Math.max(400, Math.round(height * scale));
  const rgba = new Uint8Array(w * h * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: Rgb, a = 255): void => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x++) {
        const i = (y * w + x) * 4;
        rgba[i] = c.r; rgba[i + 1] = c.g; rgba[i + 2] = c.b; rgba[i + 3] = a;
      }
    }
  };
  fill(0, 0, w, h, { r: 245, g: 239, b: 227 });
  // frame rule
  for (let x = 0; x < w; x++) { fill(x, 20, x + 1, 22, { r: 216, g: 205, b: 184 }); fill(x, h - 21, x + 1, h - 19, { r: 216, g: 205, b: 184 }); }
  for (let y = 0; y < h; y++) { fill(20, y, 22, y + 1, { r: 216, g: 205, b: 184 }); fill(w - 21, y, w - 19, y + 1, { r: 216, g: 205, b: 184 }); }
  drawText(rgba, w, h, 30, 34, frameTitle, { r: 43, g: 36, b: 24 }, 2);
  const cellW = Math.max(140, Math.round(160 * scale));
  const cellH = Math.max(90, Math.round(100 * scale));
  const cols = Math.max(1, Math.floor((w - 80) / (cellW + 12)));
  notes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = 40 + col * (cellW + 12);
    const y0 = 90 + row * (cellH + 12);
    fill(x0, y0, x0 + cellW, y0 + cellH, { r: 244, g: 222, b: 122 });
    fill(x0, y0, x0 + cellW, y0 + 2, { r: 223, g: 189, b: 75 });
    if (n.cluster) {
      drawText(rgba, w, h, x0 + 6, y0 + 6, `${n.cluster}${dotTotals.has(n.cluster) ? ` (${dotTotals.get(n.cluster)} dots)` : ''}`, { r: 122, g: 111, b: 92 });
    }
    drawWrapped(rgba, w, h, x0 + 8, y0 + 26, cellW - 16, n.text ?? '[image]', { r: 43, g: 36, b: 24 });
  });
  return encodePng(w, h, rgba);
}

/** A tiny 5x7 bitmap font, enough for titles and note text in the PNG. */
const FONT: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  b: ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  c: ['00000', '00000', '01111', '10000', '10000', '10000', '01111'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01111'],
  f: ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
  g: ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
  h: ['10000', '10000', '11110', '10001', '10001', '10001', '10001'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  j: ['00010', '00000', '00110', '00010', '00010', '10010', '01100'],
  k: ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  m: ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
  n: ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  p: ['00000', '11110', '10001', '10001', '11110', '10000', '10000'],
  q: ['00000', '01111', '10001', '10001', '01111', '00001', '00001'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
  t: ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
  u: ['00000', '00000', '10001', '10001', '10001', '10001', '01111'],
  v: ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
  w: ['00000', '00000', '10001', '10101', '10101', '10101', '01010'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  y: ['00000', '10001', '10001', '01111', '00001', '10001', '01110'],
  z: ['00000', '00000', '11111', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '(': ['00110', '01000', '10000', '10000', '10000', '01000', '00110'],
  ')': ['01100', '00010', '00001', '00001', '00001', '00010', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
  '*': ['00000', '01010', '00100', '11111', '00100', '01010', '00000'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};

function glyph(ch: string): string[] | null {
  return FONT[ch] ?? null;
}

function drawText(rgba: Uint8Array, w: number, h: number, x: number, y: number, text: string, color: Rgb, size = 1): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = glyph(ch);
    if (!g) { cx += 6 * size; continue; }
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy][gx] === '1') {
          for (let sy = 0; sy < size; sy++) {
            for (let sx = 0; sx < size; sx++) {
              const px = cx + gx * size + sx;
              const py = y + gy * size + sy;
              if (px >= 0 && px < w && py >= 0 && py < h) {
                const i = (py * w + px) * 4;
                rgba[i] = color.r; rgba[i + 1] = color.g; rgba[i + 2] = color.b; rgba[i + 3] = 255;
              }
            }
          }
        }
      }
    }
    cx += 6 * size;
    if (cx > w - 10) break;
  }
}

function drawWrapped(rgba: Uint8Array, w: number, h: number, x: number, y: number, maxWidth: number, text: string, color: Rgb): void {
  const words = text.split(/\s+/);
  let line = '';
  let ly = y;
  const flush = (): void => {
    drawText(rgba, w, h, x, ly, line.trim(), color);
    ly += 9;
    line = '';
  };
  for (const word of words) {
    if ((line + ' ' + word).trim().length * 6 > maxWidth) flush();
    line += ` ${word}`;
  }
  if (line.trim().length > 0) flush();
}
