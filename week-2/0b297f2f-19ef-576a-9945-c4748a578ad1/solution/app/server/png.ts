// A small RGB raster and PNG encoder for the snapshot elevation drawing.
import { crc32, deflateSync } from "node:zlib";

export type Rgb = readonly [number, number, number];

export class Raster {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, background);
  }

  fill(x: number, y: number, w: number, h: number, [r, g, b]: Rgb): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        const i = (yy * this.width + xx) * 3;
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
      }
    }
  }

  outline(x: number, y: number, w: number, h: number, colour: Rgb, thickness = 2): void {
    const t = thickness;
    this.fill(x, y, Math.max(w, t), t, colour);
    this.fill(x, y + Math.max(h, t) - t, Math.max(w, t), t, colour);
    this.fill(x, y, t, Math.max(h, t), colour);
    this.fill(x + Math.max(w, t) - t, y, t, Math.max(h, t), colour);
  }

  png(): Buffer {
    const rowLength = this.width * 3 + 1;
    const raw = Buffer.alloc(rowLength * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * rowLength] = 0;
      Buffer.from(this.pixels.buffer, y * this.width * 3, this.width * 3).copy(raw, y * rowLength + 1);
    }
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([head, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}
