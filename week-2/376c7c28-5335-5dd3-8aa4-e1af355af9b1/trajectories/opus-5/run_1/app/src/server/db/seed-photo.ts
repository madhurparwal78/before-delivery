import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const SIZE = 96;

/** A small PNG the app draws itself, so seeded pieces have a real intake photo. */
export function seedPhoto(pieceId: string): Buffer {
  const seed = createHash('sha256').update(pieceId).digest();
  const scanlines: Buffer[] = [];
  for (let y = 0; y < SIZE; y += 1) {
    const row = Buffer.alloc(1 + SIZE * 3);
    for (let x = 0; x < SIZE; x += 1) {
      const tint = (seed[(x + y) % seed.length] as number) >> 2;
      const offset = 1 + x * 3;
      row[offset] = 60 + tint;
      row[offset + 1] = 40 + ((tint * 2) % 90);
      row[offset + 2] = 32 + (tint % 40);
    }
    scanlines.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(scanlines))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
