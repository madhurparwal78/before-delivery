import { deflateSync } from 'node:zlib';

/** A small true-colour PNG encoder: the export's raster is drawn pixel by pixel. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const PNG_COLOURS = {
  ground: { r: 243, g: 240, b: 232 },
  ink: { r: 22, g: 32, b: 46 },
  scopeRed: { r: 200, g: 50, b: 63 },
  teal: { r: 43, g: 111, b: 119 },
} as const;

export class Raster {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Buffer;

  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      this.pixels[i * 3] = background.r;
      this.pixels[i * 3 + 1] = background.g;
      this.pixels[i * 3 + 2] = background.b;
    }
  }

  setPixel(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.pixels[offset] = colour.r;
    this.pixels[offset + 1] = colour.g;
    this.pixels[offset + 2] = colour.b;
  }

  fillRect(x: number, y: number, width: number, height: number, colour: Rgb): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) this.setPixel(column, row, colour);
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, thickness: number, colour: Rgb): void {
    this.fillRect(x, y, width, thickness, colour);
    this.fillRect(x, y + height - thickness, width, thickness, colour);
    this.fillRect(x, y, thickness, height, colour);
    this.fillRect(x + width - thickness, y, thickness, height, colour);
  }

  toPng(): Buffer {
    const raw = Buffer.alloc(this.height * (this.width * 3 + 1));
    for (let row = 0; row < this.height; row += 1) {
      const target = row * (this.width * 3 + 1);
      raw[target] = 0;
      this.pixels.copy(raw, target + 1, row * this.width * 3, (row + 1) * this.width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ((CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
