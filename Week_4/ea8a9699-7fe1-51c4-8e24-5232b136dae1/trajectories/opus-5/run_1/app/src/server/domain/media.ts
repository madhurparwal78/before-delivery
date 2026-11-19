export type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';

export const mediaExtensions: Record<MediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Accepted types are judged only from a file's leading bytes. */
export function sniffMediaType(bytes: Buffer): MediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    return 'video/mp4';
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return 'video/webm';
  }
  return null;
}

export function isImageType(type: MediaType): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

const jpegSegmentsToDrop = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(bytes: Buffer): Buffer {
  const parts: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xda) {
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (!jpegSegmentsToDrop.has(marker)) {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  return Buffer.concat(parts);
}

const pngChunksToDrop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(bytes: Buffer): Buffer {
  const parts: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > bytes.length) {
      parts.push(bytes.subarray(offset));
      return Buffer.concat(parts);
    }
    if (!pngChunksToDrop.has(type)) {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  if (offset < bytes.length) {
    parts.push(bytes.subarray(offset));
  }
  return Buffer.concat(parts);
}

const webpChunksToDrop = new Set(['EXIF', 'XMP ']);
const vp8xExifFlag = 0x08;
const vp8xXmpFlag = 0x04;

function stripWebp(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('latin1');
    const length = bytes.readUInt32LE(offset + 4);
    const padded = length + (length % 2);
    const end = offset + 8 + padded;
    if (end > bytes.length) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (!webpChunksToDrop.has(type)) {
      if (type === 'VP8X') {
        const chunk = Buffer.from(bytes.subarray(offset, end));
        chunk[8] = chunk[8] & ~(vp8xExifFlag | vp8xXmpFlag);
        parts.push(chunk);
      } else {
        parts.push(bytes.subarray(offset, end));
      }
    }
    offset = end;
  }
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, payload]);
}

/**
 * The one place that removes embedded metadata. Everything else stays byte for byte as uploaded,
 * in its original order, so images are never re-encoded.
 */
export function removeMetadata(bytes: Buffer, type: MediaType): Buffer {
  switch (type) {
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/png':
      return stripPng(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    case 'video/mp4':
    case 'video/webm':
      return bytes;
  }
}
