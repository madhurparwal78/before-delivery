export type ImageKind = 'jpeg' | 'png';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Judges the type by the file's own content, never by its name. */
export function sniffImageKind(body: Buffer): ImageKind | null {
  if (body.subarray(0, 3).equals(JPEG_SIGNATURE)) return 'jpeg';
  if (body.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  return null;
}

export function contentTypeFor(kind: ImageKind): string {
  return kind === 'jpeg' ? 'image/jpeg' : 'image/png';
}

const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function stripJpeg(body: Buffer): Buffer {
  const parts: Buffer[] = [body.subarray(0, 2)];
  let index = 2;
  while (index + 1 < body.length) {
    if (body[index] !== 0xff) break;
    const marker = body[index + 1];
    if (marker === 0xd9) {
      parts.push(body.subarray(index, index + 2));
      index += 2;
      break;
    }
    if (JPEG_STANDALONE.has(marker)) {
      parts.push(body.subarray(index, index + 2));
      index += 2;
      continue;
    }
    if (marker === 0xda) {
      parts.push(body.subarray(index));
      index = body.length;
      break;
    }
    const length = body.readUInt16BE(index + 2);
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(body.subarray(index, index + 2 + length));
    index += 2 + length;
  }
  return Buffer.concat(parts);
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

function stripPng(body: Buffer): Buffer {
  const parts: Buffer[] = [body.subarray(0, 8)];
  let index = 8;
  while (index + 8 <= body.length) {
    const length = body.readUInt32BE(index);
    const type = body.subarray(index + 4, index + 8).toString('latin1');
    const end = index + 12 + length;
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(body.subarray(index, end));
    index = end;
  }
  return Buffer.concat(parts);
}

/** Removes the file's metadata, including EXIF, leaving the pixels and dimensions alone. */
export function stripImageMetadata(body: Buffer, kind: ImageKind): Buffer {
  return kind === 'jpeg' ? stripJpeg(body) : stripPng(body);
}
