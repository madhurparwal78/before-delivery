export interface WebpImage {
  width: number;
  height: number;
  /** The container rebuilt with only its image chunks, so no metadata is left. */
  bytes: Buffer;
}

interface Chunk {
  type: string;
  start: number;
  length: number;
}

/** Chunks that carry the image itself; everything else, including EXIF and XMP, is dropped. */
const IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);

function readChunks(bytes: Buffer): Chunk[] | null {
  const chunks: Chunk[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (length > bytes.length - start) return null;
    chunks.push({ type, start, length });
    offset = start + length + (length % 2);
  }
  return offset === bytes.length || offset === bytes.length + 1 ? chunks : null;
}

function lossyDimensions(bytes: Buffer, chunk: Chunk): { width: number; height: number } | null {
  if (chunk.length < 10) return null;
  const body = bytes.subarray(chunk.start, chunk.start + chunk.length);
  // A key frame starts with a 3-byte frame tag and the 3-byte start code 0x9d012a.
  if (body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) return null;
  const width = body.readUInt16LE(6) & 0x3fff;
  const height = body.readUInt16LE(8) & 0x3fff;
  return width > 0 && height > 0 ? { width, height } : null;
}

function losslessDimensions(bytes: Buffer, chunk: Chunk): { width: number; height: number } | null {
  if (chunk.length < 5) return null;
  const body = bytes.subarray(chunk.start, chunk.start + chunk.length);
  if (body[0] !== 0x2f) return null;
  const bits = body.readUInt32LE(1);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >> 14) & 0x3fff) + 1;
  return { width, height };
}

/**
 * Reads a WebP by its container and bitstream headers, refusing anything inconsistent or
 * truncated, and rebuilds it with only its image chunks.
 */
export function readWebp(bytes: Buffer): WebpImage | null {
  if (bytes.length < 16) return null;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const declared = bytes.readUInt32LE(4);
  if (declared + 8 !== bytes.length) return null;

  const chunks = readChunks(bytes);
  if (chunks === null || chunks.length === 0) return null;

  const lossy = chunks.find((chunk) => chunk.type === 'VP8 ');
  const lossless = chunks.find((chunk) => chunk.type === 'VP8L');
  const extended = chunks.find((chunk) => chunk.type === 'VP8X');

  let size: { width: number; height: number } | null = null;
  if (lossy !== undefined) size = lossyDimensions(bytes, lossy);
  else if (lossless !== undefined) size = losslessDimensions(bytes, lossless);
  else if (extended !== undefined && extended.length >= 10) {
    const body = bytes.subarray(extended.start, extended.start + extended.length);
    size = {
      width: (body.readUIntLE(4, 3) & 0xffffff) + 1,
      height: (body.readUIntLE(7, 3) & 0xffffff) + 1,
    };
  }
  if (size === null) return null;

  const kept = chunks.filter((chunk) => IMAGE_CHUNKS.has(chunk.type));
  if (kept.length === 0) return null;

  const parts: Buffer[] = [];
  for (const chunk of kept) {
    const header = Buffer.alloc(8);
    header.write(chunk.type, 0, 'latin1');
    header.writeUInt32LE(chunk.length, 4);
    parts.push(header, bytes.subarray(chunk.start, chunk.start + chunk.length));
    if (chunk.length % 2 === 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const container = Buffer.alloc(12);
  container.write('RIFF', 0, 'latin1');
  container.writeUInt32LE(body.length + 4, 4);
  container.write('WEBP', 8, 'latin1');

  return { width: size.width, height: size.height, bytes: Buffer.concat([container, body]) };
}
