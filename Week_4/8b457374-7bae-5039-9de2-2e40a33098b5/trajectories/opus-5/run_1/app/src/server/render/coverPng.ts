import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const PAPER: readonly [number, number, number] = [0xf2, 0xf6, 0xf3];
const TEAL: readonly [number, number, number] = [0x0c, 0x3b, 0x36];

/**
 * Draws a flat teal-on-paper cover: a teal disc whose edge breaks into a hex
 * halftone ramp, the same motif the rest of Dotgain uses.
 */
export function generateCoverPng(size: number, seed: number): Buffer {
  const pixels = Buffer.alloc(size * size * 3);
  const centreX = size * 0.5;
  const centreY = size * 0.4;
  const radius = size * 0.33;
  const pitch = size / 17;

  const put = (x: number, y: number, colour: readonly [number, number, number]): void => {
    const offset = (y * size + x) * 3;
    pixels[offset] = colour[0];
    pixels[offset + 1] = colour[1];
    pixels[offset + 2] = colour[2];
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) put(x, y, PAPER);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centreX;
      const dy = y - centreY;
      if (dx * dx + dy * dy <= radius * radius) put(x, y, TEAL);
    }
  }

  // The ramp: rows of shrinking dots fading from the disc into bare paper.
  const rows = 9;
  for (let row = 0; row < rows; row += 1) {
    const coverage = 1 - (row + 1) / (rows + 1);
    const dotRadius = (pitch * 0.55 * Math.sqrt(coverage)) / 1.05;
    const y = centreY + radius * 0.2 + (row + 1) * pitch * 0.92;
    const offset = (row % 2) * pitch * 0.5;
    const spread = 6 + ((seed + row) % 3);
    for (let column = -spread; column <= spread; column += 1) {
      const cx = centreX + column * pitch + offset;
      for (let py = Math.floor(y - dotRadius); py <= Math.ceil(y + dotRadius); py += 1) {
        for (let px = Math.floor(cx - dotRadius); px <= Math.ceil(cx + dotRadius); px += 1) {
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const dx = px - cx;
          const dy = py - y;
          if (dx * dx + dy * dy <= dotRadius * dotRadius) put(px, py, TEAL);
        }
      }
    }
  }

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
