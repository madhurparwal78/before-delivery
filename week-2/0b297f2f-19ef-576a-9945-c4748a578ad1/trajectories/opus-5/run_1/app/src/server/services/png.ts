import { deflateSync } from 'node:zlib';

export type Rgb = readonly [number, number, number];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** A small raster used for the frozen snapshot drawings. */
export class Raster {
  private readonly pixels: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = Buffer.alloc(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }

  fillRect(x: number, y: number, width: number, height: number, colour: Rgb): void {
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(this.width, Math.round(x + width));
    const bottom = Math.min(this.height, Math.round(y + height));
    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) {
        const offset = (row * this.width + column) * 3;
        this.pixels[offset] = colour[0];
        this.pixels[offset + 1] = colour[1];
        this.pixels[offset + 2] = colour[2];
      }
    }
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    colour: Rgb,
    thickness = 2,
  ): void {
    this.fillRect(x, y, width, thickness, colour);
    this.fillRect(x, y + height - thickness, width, thickness, colour);
    this.fillRect(x, y, thickness, height, colour);
    this.fillRect(x + width - thickness, y, thickness, height, colour);
  }

  toPng(): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.writeUInt8(8, 8);
    header.writeUInt8(2, 9);
    header.writeUInt8(0, 10);
    header.writeUInt8(0, 11);
    header.writeUInt8(0, 12);
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let row = 0; row < this.height; row += 1) {
      raw[row * (stride + 1)] = 0;
      this.pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
