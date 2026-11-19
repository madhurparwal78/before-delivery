import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, checksum]);
}

/** A flat opaque PNG of the given pixel size, used for seeded assets. */
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw.writeUInt8(0, offset);
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      raw.writeUInt8(rgb[0], offset);
      raw.writeUInt8(rgb[1], offset + 1);
      raw.writeUInt8(rgb[2], offset + 2);
      offset += 3;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeSvg(width: number, height: number, fill: string): Buffer {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>\n`;
  return Buffer.from(markup, 'utf8');
}

export type DetectedFormat = 'png' | 'jpeg' | 'pdf' | 'svg' | 'unknown';

export function detectFormat(bytes: Buffer): DetectedFormat {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const head = bytes.subarray(0, 1024).toString('utf8');
  if (/<svg[\s>]/i.test(head)) return 'svg';
  return 'unknown';
}

export interface PixelSize {
  width: number;
  height: number;
}

export function readPixelSize(bytes: Buffer, format: 'png' | 'svg'): PixelSize | null {
  if (format === 'png') {
    if (bytes.length < 24) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const markup = bytes.toString('utf8');
  const root = /<svg\b[^>]*>/i.exec(markup);
  if (!root) return null;
  const width = /\bwidth\s*=\s*"(\d+)"/i.exec(root[0]) ?? /\bwidth\s*=\s*'(\d+)'/i.exec(root[0]);
  const height = /\bheight\s*=\s*"(\d+)"/i.exec(root[0]) ?? /\bheight\s*=\s*'(\d+)'/i.exec(root[0]);
  if (!width || !height) return null;
  return { width: Number(width[1]), height: Number(height[1]) };
}
