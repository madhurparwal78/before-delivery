/**
 * Minimal, dependency-free PNG writer (truecolor, filter 0), used to store the
 * site's own generated artwork in the object store.
 */
import * as zlib from "node:zlib";

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A raw RGBA canvas kept as a flat Uint8ClampedArray. */
export class Png {
  readonly width: number;
  readonly height: number;
  private readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = background[0];
      this.data[i * 4 + 1] = background[1];
      this.data[i * 4 + 2] = background[2];
      this.data[i * 4 + 3] = 255;
    }
  }

  set(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (Math.round(y) * this.width + Math.round(x)) * 4;
    this.data[i] = colour[0];
    this.data[i + 1] = colour[1];
    this.data[i + 2] = colour[2];
    this.data[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, colour: Rgb): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, colour);
    }
  }

  outlinedRect(x: number, y: number, w: number, h: number, thickness: number, colour: Rgb): void {
    this.rect(x, y, w, thickness, colour);
    this.rect(x, y + h - thickness, w, thickness, colour);
    this.rect(x, y + thickness, thickness, h - thickness * 2, colour);
    this.rect(x + w - thickness, y + thickness, thickness, h - thickness * 2, colour);
  }

  line(x0: number, y0: number, x1: number, y1: number, thickness: number, colour: Rgb): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (dx * s) / steps;
      const y = y0 + (dy * s) / steps;
      this.dot(x, y, thickness, colour);
    }
  }

  dot(x: number, y: number, radius: number, colour: Rgb): void {
    const r = Math.max(radius / 2, 0.5);
    for (let yy = Math.ceil(y - r); yy <= Math.floor(y + r); yy++) {
      for (let xx = Math.ceil(x - r); xx <= Math.floor(x + r); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) this.set(xx, yy, colour);
      }
    }
  }

  circle(cx: number, cy: number, r: number, thickness: number, colour: Rgb): void {
    const inner = r - thickness;
    for (let yy = Math.ceil(cy - r - 1); yy <= Math.floor(cy + r + 1); yy++) {
      for (let xx = Math.ceil(cx - r - 1); xx <= Math.floor(cx + r + 1); xx++) {
        const d = Math.hypot(xx - cx, yy - cy);
        if (d <= r && d >= inner) this.set(xx, yy, colour);
      }
    }
  }

  text(str: string, x: number, y: number, scale: number, colour: Rgb): void {
    let cursor = x;
    for (const ch of str) {
      const glyph = FONT[ch.toUpperCase()];
      if (glyph) {
        for (let gy = 0; gy < glyph.length; gy++) {
          for (let gx = 0; gx < glyph[gy].length; gx++) {
            if (glyph[gy][gx] === 1) this.rect(cursor + gx * scale, y + gy * scale, scale, scale, colour);
          }
        }
      }
      const width = glyph ? Math.max(...glyph.map((row) => row.length)) : 4;
      cursor += (width + 2) * scale;
    }
  }

  encode(): Buffer {
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (stride + 1)] = 0;
      Buffer.from(this.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, this.width);
    view.setUint32(4, this.height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type RGBA
    const idat = zlib.deflateSync(raw, { level: 6 });
    return Buffer.concat([
      signature,
      chunk("IHDR", ihdr),
      chunk("IDAT", new Uint8Array(idat)),
      chunk("IEND", new Uint8Array(0)),
    ]);
  }
}

/** 3x5 uppercase pixel font, enough for labels drawn into the artwork. */
const FONT: Record<string, number[][]> = {
  A: [[0, 1, 0], [1, 0, 1], [1, 1, 1], [1, 0, 1], [1, 0, 1]],
  B: [[1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 0, 1], [1, 1, 0]],
  C: [[0, 1, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [0, 1, 1]],
  D: [[1, 1, 0], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 0]],
  E: [[1, 1, 1], [1, 0, 0], [1, 1, 0], [1, 0, 0], [1, 1, 1]],
  F: [[1, 1, 1], [1, 0, 0], [1, 1, 0], [1, 0, 0], [1, 0, 0]],
  G: [[0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 0, 1], [0, 1, 1]],
  H: [[1, 0, 1], [1, 0, 1], [1, 1, 1], [1, 0, 1], [1, 0, 1]],
  I: [[1, 1, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
  J: [[1, 1, 1], [0, 0, 1], [0, 0, 1], [1, 0, 1], [0, 1, 0]],
  K: [[1, 0, 1], [1, 0, 1], [1, 1, 0], [1, 0, 1], [1, 0, 1]],
  L: [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 1]],
  M: [[1, 0, 1], [1, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 1]],
  N: [[1, 0, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 0, 1]],
  O: [[0, 1, 0], [1, 0, 1], [1, 0, 1], [1, 0, 1], [0, 1, 0]],
  P: [[1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 0, 0], [1, 0, 0]],
  Q: [[0, 1, 0], [1, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  R: [[1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 0, 1], [1, 0, 1]],
  S: [[0, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]],
  T: [[1, 1, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
  U: [[1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1]],
  V: [[1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [0, 1, 0]],
  W: [[1, 0, 1], [1, 0, 1], [1, 1, 1], [1, 1, 1], [1, 0, 1]],
  X: [[1, 0, 1], [1, 0, 1], [0, 1, 0], [1, 0, 1], [1, 0, 1]],
  Y: [[1, 0, 1], [1, 0, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
  Z: [[1, 1, 1], [0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
  "0": [[0, 1, 0], [1, 0, 1], [1, 0, 1], [1, 0, 1], [0, 1, 0]],
  "1": [[0, 1, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
  "2": [[1, 1, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
  "3": [[1, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 1], [1, 1, 0]],
  "4": [[1, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 0, 1]],
  "5": [[1, 1, 1], [1, 0, 0], [1, 1, 0], [0, 0, 1], [1, 1, 0]],
  "6": [[0, 1, 1], [1, 0, 0], [1, 1, 0], [1, 0, 1], [0, 1, 0]],
  "7": [[1, 1, 1], [0, 0, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
  "8": [[0, 1, 0], [1, 0, 1], [0, 1, 0], [1, 0, 1], [0, 1, 0]],
  "9": [[0, 1, 0], [1, 0, 1], [0, 1, 1], [0, 0, 1], [0, 1, 0]],
  " ": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  "-": [[0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [0, 0, 0]],
  ".": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 1, 0]],
  ":": [[0, 0, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0]],
  "&": [[0, 1, 0], [1, 0, 1], [0, 1, 0], [1, 0, 1], [0, 1, 1]],
};
