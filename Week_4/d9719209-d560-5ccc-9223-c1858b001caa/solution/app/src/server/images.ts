import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

export const SLOTS = [320, 640, 1080] as const;
export type Slot = (typeof SLOTS)[number];
export const MAX_PIXELS = 50_000_000;
const WEBP_QUALITY = 82;

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface Sniffed { format: ImageFormat; width: number; height: number }

function jpegSize(data: Buffer): { width: number; height: number } | null {
  let pos = 2;
  while (pos + 9 < data.length) {
    if (data[pos] !== 0xff) { pos += 1; continue; }
    const marker = data[pos + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const length = data.readUInt16BE(pos + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: data.readUInt16BE(pos + 5), width: data.readUInt16BE(pos + 7) };
    pos += 2 + length;
  }
  return null;
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  const kind = data.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = data.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}

/** Identifies JPEG, PNG or WebP by magic bytes (whatever the name or declared type) and reads its size. */
export function sniffImage(data: Buffer): Sniffed | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    const size = jpegSize(data);
    return size ? { format: 'jpeg', ...size } : null;
  }
  if (data.length >= 30 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    const size = webpSize(data);
    return size ? { format: 'webp', ...size } : null;
  }
  return null;
}

const PNG_KEPT_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'iCCP']);

/** Drops every PNG chunk that does not describe pixels or colour (text, EXIF, private blobs). */
function stripPngMetadata(data: Buffer): Buffer {
  const kept: Buffer[] = [data.subarray(0, 8)];
  let pos = 8;
  while (pos + 12 <= data.length) {
    const size = data.readUInt32BE(pos);
    const end = pos + 12 + size;
    if (end > data.length) break;
    if (PNG_KEPT_CHUNKS.has(data.toString('latin1', pos + 4, pos + 8))) kept.push(data.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(kept);
}

export interface ProcessedImage {
  width: number;
  height: number;
  original: Buffer;
  slots: Record<Slot, Buffer>;
}

async function encode(source: Image, width: number, height: number): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
  return canvas.encode('webp', WEBP_QUALITY);
}

/**
 * Decodes (the decoder applies the EXIF orientation), then re-encodes to WebP at the original size
 * and at each slot, never upscaling. The WebP encoder writes no EXIF, XMP or IPTC data.
 */
export async function processImage(data: Buffer, sniffed: Sniffed): Promise<ProcessedImage> {
  const source = await loadImage(sniffed.format === 'png' ? stripPngMetadata(data) : data);
  const { width, height } = source;
  const slots = {} as Record<Slot, Buffer>;
  for (const slot of SLOTS) {
    const slotWidth = Math.min(slot, width);
    slots[slot] = await encode(source, slotWidth, Math.max(1, Math.round((height * slotWidth) / width)));
  }
  return { width, height, original: await encode(source, width, height), slots };
}

/** w-descriptor srcset: one entry per slot whose stored width differs from the previous slot's. */
export function srcsetFor(imageId: string, width: number): string {
  const parts: string[] = [];
  let previous: number | null = null;
  for (const slot of SLOTS) {
    const stored = Math.min(slot, width);
    if (stored !== previous) parts.push(`/media/${imageId}/${slot}.webp ${stored}w`);
    previous = stored;
  }
  return parts.join(', ');
}
