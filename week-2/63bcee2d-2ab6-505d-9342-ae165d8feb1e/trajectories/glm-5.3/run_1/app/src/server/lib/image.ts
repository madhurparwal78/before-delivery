// Site photos: strip GPS/location EXIF, apply camera orientation to the pixels.
// JPEG via jpeg-js (MIT), PNG via pngjs (MIT).

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface CleanImage {
  buffer: Buffer;
  contentType: string;
  ext: 'png' | 'jpg';
  width: number;
  height: number;
}

export function cleanPhoto(buffer: Buffer, kind: 'png' | 'jpeg'): CleanImage {
  if (kind === 'jpeg') {
    const decoded = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512 });
    const orientation = jpegOrientation(buffer);
    const rotated = applyOrientation(decoded.width, decoded.height, new Uint8Array(decoded.data), orientation);
    const encoded = jpeg.encode({ width: rotated.width, height: rotated.height, data: rotated.data }, 90);
    return { buffer: encoded.data, contentType: 'image/jpeg', ext: 'jpg', width: rotated.width, height: rotated.height };
  }
  const png = stripPngExif(buffer);
  const parsed = PNG.sync.read(png);
  return { buffer: png, contentType: 'image/png', ext: 'png', width: parsed.width, height: parsed.height };
}

function stripPngExif(buffer: Buffer): Buffer {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return buffer;
  const chunks: Buffer[] = [signature];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > buffer.length) break;
    const chunk = buffer.subarray(offset, end);
    // Drop metadata chunks that can carry location or camera data.
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)) {
      chunks.push(chunk);
    }
    if (type === 'IEND') break;
    offset = end;
  }
  return Buffer.concat(chunks);
}

function jpegOrientation(buffer: Buffer): number {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    const marker = buffer[offset];
    if (marker !== 0xff) break;
    const code = buffer[offset + 1];
    if (code === 0xd8 || code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (code === 0xe1) {
      const segment = buffer.subarray(offset + 4, offset + 2 + length);
      if (segment.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
        const tiff = segment.subarray(6);
        const endian = tiff.subarray(0, 2).toString('latin1');
        const big = endian === 'MM';
        const read16 = (pos: number) => (big ? tiff.readUInt16BE(pos) : tiff.readUInt16LE(pos));
        const read32 = (pos: number) => (big ? tiff.readUInt32BE(pos) : tiff.readUInt32LE(pos));
        const ifdOffset = read32(4);
        const count = read16(ifdOffset);
        for (let i = 0; i < count; i++) {
          const entryOffset = ifdOffset + 2 + i * 12;
          if (read16(entryOffset) === 0x0112) {
            return read16(entryOffset + 8);
          }
        }
      }
    }
    offset += 2 + length;
  }
  return 1;
}

function applyOrientation(width: number, height: number, data: Uint8Array, orientation: number): { width: number; height: number; data: Uint8Array } {
  if (orientation < 2 || orientation > 8) return { width, height, data };
  const targetWidth = orientation >= 5 && orientation <= 8 ? height : width;
  const targetHeight = orientation >= 5 && orientation <= 8 ? width : height;
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let tx = x;
      let ty = y;
      switch (orientation) {
        case 2: tx = width - 1 - x; break;
        case 3: tx = width - 1 - x; ty = height - 1 - y; break;
        case 4: ty = height - 1 - y; break;
        case 5: tx = y; ty = x; break;
        case 6: tx = y; ty = width - 1 - x; break;
        case 7: tx = height - 1 - y; ty = x; break;
        case 8: tx = height - 1 - y; ty = width - 1 - x; break;
      }
      const src = (y * width + x) * 4;
      const dst = (ty * targetWidth + tx) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}
