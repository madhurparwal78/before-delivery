export type ImageKind = 'jpeg' | 'png' | 'webp';

export const IMAGE_CONTENT_TYPES: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const IMAGE_EXTENSIONS: Record<ImageKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** The kind is judged by content, whatever the file name or declared type. */
export function sniffImage(data: Buffer): ImageKind | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Drops every JPEG APPn and COM segment, which carries EXIF, XMP and any comment. */
function stripJpeg(data: Buffer): Buffer {
  const parts: Buffer[] = [data.subarray(0, 2)];
  let at = 2;
  while (at + 1 < data.length) {
    if (data[at] !== 0xff) break;
    const marker = data[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (marker === 0xda) {
      parts.push(data.subarray(at));
      at = data.length;
      break;
    }
    if (at + 3 >= data.length) break;
    const length = data.readUInt16BE(at + 2);
    const end = at + 2 + length;
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(data.subarray(at, Math.min(end, data.length)));
    at = end;
  }
  return Buffer.concat(parts);
}

const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'iCCP']);

function stripPng(data: Buffer): Buffer {
  const parts: Buffer[] = [data.subarray(0, 8)];
  let at = 8;
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > data.length) break;
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(data.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ', 'ICCP']);

function stripWebp(data: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let at = 12;
  while (at + 8 <= data.length) {
    const type = data.toString('ascii', at, at + 4);
    const length = data.readUInt32LE(at + 4);
    const padded = length + (length % 2);
    const end = at + 8 + padded;
    if (end > data.length) break;
    if (!WEBP_METADATA_CHUNKS.has(type)) chunks.push(data.subarray(at, end));
    at = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  const out = Buffer.concat([header, body]);
  // A stripped VP8X flag block keeps its metadata bits; clear them so nothing claims EXIF.
  if (out.length >= 21 && out.toString('ascii', 12, 16) === 'VP8X') {
    out[20] &= ~0b00001100;
  }
  return out;
}

/** Removes every embedded metadata block, so no stored copy carries location data. */
export function stripMetadata(data: Buffer, kind: ImageKind): Buffer {
  switch (kind) {
    case 'jpeg':
      return stripJpeg(data);
    case 'png':
      return stripPng(data);
    case 'webp':
      return stripWebp(data);
  }
}
