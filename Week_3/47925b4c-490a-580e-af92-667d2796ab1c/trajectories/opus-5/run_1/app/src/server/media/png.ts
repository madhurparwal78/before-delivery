import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, check]);
}

function encode(width: number, height: number, colourType: 0 | 2, scanlines: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(colourType, 9);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An 8-bit grey PNG with no time or text chunks, byte-identical for equal pixels. */
export function encodeGreyPng(width: number, height: number, grey: Uint8Array): Buffer {
  const scanlines = Buffer.alloc(height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (width + 1)] = 0;
    Buffer.from(grey.buffer, grey.byteOffset + row * width, width).copy(scanlines, row * (width + 1) + 1);
  }
  return encode(width, height, 0, scanlines);
}

export function encodeRgbPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  let out = 0;
  for (let row = 0; row < height; row += 1) {
    scanlines[out] = 0;
    out += 1;
    for (let column = 0; column < width; column += 1) {
      const source = (row * width + column) * 4;
      scanlines[out] = rgba[source] ?? 0;
      scanlines[out + 1] = rgba[source + 1] ?? 0;
      scanlines[out + 2] = rgba[source + 2] ?? 0;
      out += 3;
    }
  }
  return encode(width, height, 2, scanlines);
}
