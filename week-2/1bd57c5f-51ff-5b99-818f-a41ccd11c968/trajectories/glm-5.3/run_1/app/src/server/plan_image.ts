/** Minimal PNG writer for the seeded floor-plan drawings: an invented line drawing
 *  in a 3:2 landscape shape with the rooms outlined in blueprint blue on paper. */

import { deflateSync } from "node:zlib";

const W = 1200;
const H = 800;

const BLUE = [43, 84, 122];
const PAPER = [250, 247, 240];
const GRAPHITE = [52, 50, 46];

type Rooms = { name: string; corners: [number, number][] }[];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function putPixel(px: Buffer, x: number, y: number, rgb: readonly number[]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  px[o] = rgb[0];
  px[o + 1] = rgb[1];
  px[o + 2] = rgb[2];
}

function drawLine(px: Buffer, x0: number, y0: number, x1: number, y1: number, rgb: readonly number[], width: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const half = Math.floor(width / 2);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        putPixel(px, x + dx, y + dy, rgb);
      }
    }
  }
}

function drawText(px: Buffer, text: string, x0: number, y0: number, rgb: readonly number[]): void {
  // A tiny 5x7 bitmap font in condensed capitals is enough for room labels.
  const glyphs: Record<string, string[]> = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "&": ["00000", "00110", "01001", "01010", "10010", "10001", "01101"],
  };
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = glyphs[ch];
    if (g !== undefined) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (g[r][c] === "1") putPixel(px, x + c, y0 + r, rgb);
        }
      }
    }
    x += 6;
  }
}

export function makePlanImage(rooms: Rooms, title: string): Buffer {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = PAPER[0];
    px[i * 3 + 1] = PAPER[1];
    px[i * 3 + 2] = PAPER[2];
  }
  // Faint grid of small squares, about the size of a line of body text.
  for (let gx = 0; gx < W; gx += 16) {
    for (let y = 0; y < H; y++) putPixel(px, gx, y, [243, 239, 231]);
  }
  for (let gy = 0; gy < H; gy += 16) {
    for (let x = 0; x < W; x++) putPixel(px, x, gy, [243, 239, 231]);
  }
  const pad = 60;
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  for (const room of rooms) {
    for (let i = 0; i < room.corners.length; i++) {
      const a = room.corners[i];
      const b = room.corners[(i + 1) % room.corners.length];
      drawLine(px, pad + a[0] * iw, pad + a[1] * ih, pad + b[0] * iw, pad + b[1] * ih, BLUE, 3);
    }
    const mx = room.corners.reduce((s, c) => s + c[0], 0) / room.corners.length;
    const my = room.corners.reduce((s, c) => s + c[1], 0) / room.corners.length;
    drawText(px, room.name, pad + mx * iw - room.name.length * 3, pad + my * ih - 4, GRAPHITE);
  }
  drawText(px, title, pad, 20, GRAPHITE);
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
