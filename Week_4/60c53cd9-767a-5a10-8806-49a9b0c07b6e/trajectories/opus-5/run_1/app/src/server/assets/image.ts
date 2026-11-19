/** PNG writing, and the signature and decode checks every photo upload passes. */

import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export type ImageKind = 'png' | 'jpeg';

export function md5Hex(body: Buffer): string {
  return createHash('md5').update(body).digest('hex');
}

export function hasSignature(body: Buffer, kind: ImageKind): boolean {
  const signature = kind === 'png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  return body.length >= signature.length && body.subarray(0, signature.length).equals(signature);
}

/** The object's own signature decides the content type it is served with. */
export function detectKind(body: Buffer): ImageKind | null {
  if (hasSignature(body, 'png')) return 'png';
  if (hasSignature(body, 'jpeg')) return 'jpeg';
  return null;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Reads the pixel size, or null when the bytes cannot be decoded as that image. */
export function readImageSize(body: Buffer, kind: ImageKind): ImageSize | null {
  return kind === 'png' ? readPngSize(body) : readJpegSize(body);
}

function readPngSize(body: Buffer): ImageSize | null {
  if (!hasSignature(body, 'png')) return null;
  let offset = PNG_SIGNATURE.length;
  let size: ImageSize | null = null;
  const pixelData: Buffer[] = [];
  let sawEnd = false;
  while (offset + 8 <= body.length) {
    const length = body.readUInt32BE(offset);
    const type = body.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > body.length) return null;
    if (type === 'IHDR') {
      if (length < 13) return null;
      size = { width: body.readUInt32BE(dataStart), height: body.readUInt32BE(dataStart + 4) };
    } else if (type === 'IDAT') {
      pixelData.push(body.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!size || !sawEnd || pixelData.length === 0) return null;
  if (size.width === 0 || size.height === 0) return null;
  try {
    inflateSync(Buffer.concat(pixelData));
  } catch {
    return null;
  }
  return size;
}

function readJpegSize(body: Buffer): ImageSize | null {
  if (!hasSignature(body, 'jpeg')) return null;
  let offset = 2;
  let size: ImageSize | null = null;
  while (offset + 4 <= body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = body[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = body.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > body.length) return null;
      size = { height: body.readUInt16BE(offset + 5), width: body.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  if (!size || size.width === 0 || size.height === 0) return null;
  const tail = body.subarray(Math.max(0, body.length - 2));
  if (!(tail.length === 2 && tail[0] === 0xff && tail[1] === 0xd9)) return null;
  return size;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(body: Buffer): number {
  let crc = -1;
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** Writes an 8-bit RGB PNG from a tightly packed width*height*3 raster. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[(stride + 1) * y] = 0;
    rgb.copy(raw, (stride + 1) * y + 1, stride * y, stride * (y + 1));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
