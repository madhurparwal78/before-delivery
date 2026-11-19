export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_IMAGE_SIDE = 8000;

export function isImageContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The server decides an image's type from its leading bytes, never from the declared type. */
export function sniffImageType(bytes: Buffer): ImageContentType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function pngDimensions(bytes: Buffer): ImageDimensions | null {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR", width, height.
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): ImageDimensions | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('latin1', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (chunkType === 'VP8X' && payload + 10 <= bytes.length) {
      const width = 1 + (bytes.readUIntLE(payload + 4, 3) & 0xffffff);
      const height = 1 + (bytes.readUIntLE(payload + 7, 3) & 0xffffff);
      return { width, height };
    }
    if (chunkType === 'VP8 ' && payload + 10 <= bytes.length) {
      return {
        width: bytes.readUInt16LE(payload + 6) & 0x3fff,
        height: bytes.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    if (chunkType === 'VP8L' && payload + 5 <= bytes.length) {
      const bits = bytes.readUInt32LE(payload + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  return null;
}

/** Reads the dimensions from the image header. */
export function readImageDimensions(bytes: Buffer, type: ImageContentType): ImageDimensions | null {
  switch (type) {
    case 'image/png':
      return pngDimensions(bytes);
    case 'image/jpeg':
      return jpegDimensions(bytes);
    case 'image/webp':
      return webpDimensions(bytes);
  }
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

function stripPngMetadata(bytes: Buffer): Buffer {
  const pieces: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    if (!PNG_METADATA_CHUNKS.has(chunkType)) pieces.push(bytes.subarray(offset, end));
    offset = end;
    if (chunkType === 'IEND') break;
  }
  return Buffer.concat(pieces);
}

/** APP1 holds Exif and XMP; APP13 holds Photoshop image resources. */
const JPEG_METADATA_MARKERS = new Set([0xe1, 0xed, 0xee, 0xef]);

function stripJpegMetadata(bytes: Buffer): Buffer {
  const pieces: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the end of the file.
      pieces.push(bytes.subarray(offset));
      return Buffer.concat(pieces);
    }
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (end > bytes.length) break;
    const segment = bytes.subarray(offset, end);
    const isXmpOrExif = JPEG_METADATA_MARKERS.has(marker);
    if (!isXmpOrExif) pieces.push(segment);
    offset = end;
  }
  return Buffer.concat(pieces);
}

const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);

function stripWebpMetadata(bytes: Buffer): Buffer {
  const pieces: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('latin1', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + chunkSize + (chunkSize % 2);
    if (end > bytes.length) {
      pieces.push(bytes.subarray(offset));
      break;
    }
    if (!WEBP_METADATA_CHUNKS.has(chunkType)) pieces.push(bytes.subarray(offset, end));
    offset = end;
  }
  const payload = Buffer.concat(pieces);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, payload]);
}

/** Removes every metadata segment or chunk that could carry location or camera data. */
export function stripImageMetadata(bytes: Buffer, type: ImageContentType): Buffer {
  switch (type) {
    case 'image/png':
      return stripPngMetadata(bytes);
    case 'image/jpeg':
      return stripJpegMetadata(bytes);
    case 'image/webp':
      return stripWebpMetadata(bytes);
  }
}
