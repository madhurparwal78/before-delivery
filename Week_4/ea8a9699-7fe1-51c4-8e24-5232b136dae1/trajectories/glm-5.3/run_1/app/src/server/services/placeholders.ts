// Seed media generation: placeholder PNGs and the bundled sample clip.

import zlib from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A small deterministic placeholder PNG with no metadata chunks. */
export function placeholderPng(seed: number, width = 160, height = 120): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  parts.push(pngChunk('IHDR', ihdr(width, height)));
  parts.push(pngChunk('IDAT', zlib.deflateSync(rawPixels(seed, width, height))));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function ihdr(width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = 8; // bit depth
  b[9] = 2; // truecolor
  return b;
}

function rawPixels(seed: number, width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = (x * 3 + seed * 37 + y) % 256;
      row[2 + x * 3] = (y * 5 + seed * 53) % 256;
      row[3 + x * 3] = ((x + y) * 7 + seed * 71) % 256;
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc, 0);
  return Buffer.concat([head, data, tail]);
}

let crcTable: number[] | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) % 256]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** The bundled sample WebM clip of a moving test pattern (25fps, 2000ms, 50 frames). */
export async function sampleClipWebm(): Promise<Buffer> {
  return readFile(path.resolve(moduleDir, '../../../assets/capstan-reel.webm'));
}
