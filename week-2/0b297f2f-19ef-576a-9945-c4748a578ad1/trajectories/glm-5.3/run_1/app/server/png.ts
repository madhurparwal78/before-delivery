import { deflateSync } from 'node:zlib';

function crc32(data: Buffer): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Minimal non-interlaced 8-bit RGB PNG encoder with no filters. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 2;  // colour type: truecolour
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Rgb { r: number; g: number; b: number }

export class Canvas {
  readonly data: Buffer;
  constructor(readonly width: number, readonly height: number, background: Rgb) {
    this.data = Buffer.alloc(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }

  fillRect(x: number, y: number, w: number, h: number, colour: Rgb): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.width + px) * 3;
        this.data[i] = colour.r;
        this.data[i + 1] = colour.g;
        this.data[i + 2] = colour.b;
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, thickness: number, colour: Rgb): void {
    this.fillRect(x, y, w, thickness, colour);
    this.fillRect(x, y + h - thickness, w, thickness, colour);
    this.fillRect(x, y, thickness, h, colour);
    this.fillRect(x + w - thickness, y, thickness, h, colour);
  }

  line(x0: number, y0: number, x1: number, y1: number, thickness: number, colour: Rgb): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.fillRect(
        x0 + (x1 - x0) * t - thickness / 2,
        y0 + (y1 - y0) * t - thickness / 2,
        Math.max(1, thickness),
        Math.max(1, thickness),
        colour
      );
    }
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

export const COLOURS = {
  plaster: { r: 0xf5, g: 0xf0, b: 0xe8 },
  ink: { r: 0x21, g: 0x1d, b: 0x1a },
  stone: { r: 0xd8, g: 0xd1, b: 0xc5 },
  accent: { r: 0xc2, g: 0x5e, b: 0x1e },
};
