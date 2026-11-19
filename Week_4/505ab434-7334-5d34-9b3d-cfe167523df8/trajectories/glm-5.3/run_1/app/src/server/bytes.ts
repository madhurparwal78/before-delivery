import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

/** Deterministic PNG encoder for seed derivative bytes. */
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const shade = ((x + y) % 16 === 0) ? 1.0 : 0.85;
      raw.push(Math.round(rgb[0] * shade), Math.round(rgb[1] * shade), Math.round(rgb[2] * shade), 255);
    }
  }
  const rawBuf = Buffer.from(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(rawBuf);
  const out: Buffer[] = [];
  out.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  out.push(chunk('IHDR', ihdr));
  out.push(chunk('IDAT', idat));
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function makeSvg(width: number, height: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#1F4E8C"/></svg>`;
  return Buffer.from(svg, 'utf8');
}

export function pngBytes(width: number, height: number): number {
  // Seed PNGs are 8-byte-depth RGBA; the exact size is computed by encoding.
  return makePng(width, height, [31, 78, 140]).length;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
