// Licence certificates: the type is judged by the file's leading bytes only.
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export function detectImageType(data: Buffer): ImageType | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 12 && data.slice(0, 4).toString('ascii') === 'RIFF' && data.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// Strip GPS location chunks from PNG while keeping the pixels.
export function stripPngLocation(data: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 8 || !data.subarray(0, 8).equals(signature)) return data;
  const chunks: Buffer[] = [signature];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const total = 12 + length;
    if (offset + total > data.length) break;
    const chunk = data.subarray(offset, offset + total);
    if (type !== 'eXIf' || !pngChunkHasGps(chunk)) {
      chunks.push(chunk);
    }
    offset += total;
    if (type === 'IEND') break;
  }
  return Buffer.concat(chunks);
}

function pngChunkHasGps(chunk: Buffer): boolean {
  const data = chunk.subarray(8, chunk.length - 4);
  return data.toString('latin1').includes('GPS');
}

// JPEG: APP1 Exif segments are dropped entirely when they carry GPS data, the
// orientation tag being preserved means we only strip the GPS IFD pointer;
// dropping a GPS-only APP1 is equivalent because the orientation tag lives in
// IFD0. APP0/APP2 and other markers pass through unchanged.
export function stripJpegLocation(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data;
  const out: number[] = [0xff, 0xd8];
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(data[offset], data[offset + 1]);
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      out.push(...Array.from(data.subarray(offset)));
      return Buffer.from(out);
    }
    const length = data.readUInt16BE(offset + 2);
    const segment = data.subarray(offset, offset + 2 + length);
    const isExif = marker === 0xe1 && segment.subarray(4, 10).toString('ascii') === 'Exif\x00\x00';
    if (!(isExif && jpegSegmentHasGps(segment))) {
      out.push(...Array.from(segment));
    }
    offset += 2 + length;
  }
  return Buffer.concat([Buffer.from(out), data.subarray(offset)]);
}

function jpegSegmentHasGps(segment: Buffer): boolean {
  return segment.toString('latin1').includes('GPS');
}

// WebP: EXIF chunks are removed when they carry GPS data; the VP8/VP8L/VP8X
// chunk holds the pixels and passes through untouched.
export function stripWebpLocation(data: Buffer): Buffer {
  if (data.length < 12 || data.subarray(0, 4).toString('ascii') !== 'RIFF' || data.subarray(8, 12).toString('ascii') !== 'WEBP') return data;
  const size = data.readUInt32LE(4) + 8;
  const out: Buffer[] = [data.subarray(0, 12)];
  let offset = 12;
  while (offset + 8 <= Math.min(data.length, size)) {
    const fourcc = data.subarray(offset, offset + 4).toString('ascii');
    const length = data.readUInt32LE(offset + 4);
    const padded = length + (length % 2);
    const chunk = data.subarray(offset, offset + 8 + padded);
    if (!(fourcc === 'EXIF' && chunk.toString('latin1').includes('GPS'))) {
      out.push(chunk);
    }
    offset += 8 + padded;
  }
  return Buffer.concat(out);
}

export function stripLocation(data: Buffer, type: ImageType): Buffer {
  if (type === 'image/png') return stripPngLocation(data);
  if (type === 'image/jpeg') return stripJpegLocation(data);
  return stripWebpLocation(data);
}
