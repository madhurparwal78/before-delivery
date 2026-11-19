import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';

export type ImageFormat = 'png' | 'jpeg';

export const DISPLAY_WIDTHS = [236, 474, 736] as const;

export interface ImageFacts {
  format: ImageFormat;
  width: number;
  height: number;
  sha256: string;
}

export interface ProcessedImage extends ImageFacts {
  original: Buffer;
  variants: { width: number; body: Buffer }[];
}

/** The type comes from the first bytes, never from the file name. */
export function detectFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

export function extensionFor(format: ImageFormat): string {
  return format === 'png' ? 'png' : 'jpg';
}

export function contentTypeFor(format: ImageFormat): string {
  return format === 'png' ? 'image/png' : 'image/jpeg';
}

/** Upright dimensions, measured after the orientation is applied. */
export async function uprightSize(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(bytes).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return null;
    const orientation = metadata.orientation ?? 1;
    return orientation >= 5 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}

function encode(pipeline: Sharp, format: ImageFormat): Promise<Buffer> {
  return format === 'png'
    ? pipeline.png({ compressionLevel: 9 }).toBuffer()
    : pipeline.jpeg({ quality: 88, mozjpeg: false }).toBuffer();
}

export async function hashPixels(bytes: Buffer): Promise<string> {
  const raw = await sharp(bytes).rotate().ensureAlpha().raw().toBuffer();
  return createHash('sha256').update(raw).digest('hex');
}

export async function processImage(bytes: Buffer, format: ImageFormat): Promise<ProcessedImage> {
  const upright = sharp(bytes).rotate();
  const original = await encode(upright.clone(), format);
  const size = await sharp(original).metadata();
  const width = size.width ?? 0;
  const height = size.height ?? 0;
  const sha256 = await hashPixels(bytes);
  const variants: { width: number; body: Buffer }[] = [];
  for (const target of DISPLAY_WIDTHS) {
    if (target > width) continue;
    const body = await encode(sharp(original).resize({ width: target }), format);
    variants.push({ width: target, body });
  }
  return { format, width, height, sha256, original, variants };
}

export async function solidImage(
  width: number,
  height: number,
  format: ImageFormat,
  color: string,
): Promise<Buffer> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: color },
  });
  return encode(pipeline, format);
}
