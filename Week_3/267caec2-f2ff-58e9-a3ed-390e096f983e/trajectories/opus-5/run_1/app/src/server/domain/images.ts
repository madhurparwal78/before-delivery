import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { badDimensions, fileTooLarge, unreadableImage, unsupportedType } from '../copy';

export const MAX_FILE_BYTES = 8_000_000;
export const MAX_IMAGES_PER_ENTRY = 6;
const MIN_SIDE = 640;
const MAX_SIDE = 4096;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export interface DecodedImage {
  contentType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
  bytes: Buffer;
}

function detect(data: Buffer): 'image/png' | 'image/jpeg' | null {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (data.subarray(0, 3).equals(JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/** Checks by content, size and pixels, then re-encodes so only server bytes are ever stored. */
export function acceptImage(data: Buffer): DecodedImage {
  if (data.length > MAX_FILE_BYTES) throw fileTooLarge();
  const contentType = detect(data);
  if (contentType === null) throw unsupportedType();

  let width: number;
  let height: number;
  let pixels: Buffer;
  try {
    if (contentType === 'image/png') {
      const png = PNG.sync.read(data);
      width = png.width;
      height = png.height;
      pixels = Buffer.from(png.data);
    } else {
      const raw = jpeg.decode(data, { useTArray: true, maxMemoryUsageInMB: 1024 });
      width = raw.width;
      height = raw.height;
      pixels = Buffer.from(raw.data);
    }
  } catch {
    throw unreadableImage();
  }
  if (width < MIN_SIDE || width > MAX_SIDE || height < MIN_SIDE || height > MAX_SIDE) {
    throw badDimensions();
  }

  if (contentType === 'image/png') {
    const clean = new PNG({ width, height });
    pixels.copy(clean.data);
    return { contentType, extension: 'png', width, height, bytes: PNG.sync.write(clean) };
  }
  const encoded = jpeg.encode({ data: pixels, width, height }, 85);
  return { contentType, extension: 'jpg', width, height, bytes: Buffer.from(encoded.data) };
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.slice(0, 100);
}
