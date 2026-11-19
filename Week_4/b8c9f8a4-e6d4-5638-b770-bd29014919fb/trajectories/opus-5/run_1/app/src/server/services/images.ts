import sharp from 'sharp';
import { hasGpsData } from './exif';

export const FILE_LIMIT_BYTES = 8_000_000;
export const DERIVATIVE_LONG_EDGE = 1_600;

export interface PlateMask {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type JudgedKind = 'jpeg' | 'png' | 'pdf' | 'rejected';

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/**
 * Judges content by its bytes. A JPEG or PNG must decode fully, so a truncated
 * image, an SVG, HTML or a renamed non-image is rejected whatever its name says.
 */
export const judgeContent = async (bytes: Buffer): Promise<JudgedKind> => {
  if (bytes.length >= PDF_MAGIC.length && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';
  try {
    const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
    if (metadata.format !== 'jpeg' && metadata.format !== 'png') return 'rejected';
    await sharp(bytes, { failOn: 'warning' }).raw().toBuffer();
    return metadata.format;
  } catch {
    return 'rejected';
  }
};

export const originalHoldsLocation = async (bytes: Buffer): Promise<boolean> => {
  try {
    const metadata = await sharp(bytes).metadata();
    return hasGpsData(metadata.exif);
  } catch {
    return false;
  }
};

/**
 * The buyer copy: turned upright by the file's orientation tag, long edge at most
 * 1,600 pixels, no metadata of any kind, and the plate mask filled with one solid
 * dark colour. Masks are fractions of the upright image.
 */
export const buildBuyerDerivative = async (bytes: Buffer, mask: PlateMask | null): Promise<Buffer> => {
  const resized = await sharp(bytes, { failOn: 'warning' })
    .rotate()
    .resize({
      width: DERIVATIVE_LONG_EDGE,
      height: DERIVATIVE_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer({ resolveWithObject: true });

  const { width, height } = resized.info;
  let pipeline = sharp(resized.data);
  if (mask !== null) {
    const left = Math.round(mask.x * width);
    const top = Math.round(mask.y * height);
    const maskWidth = Math.max(1, Math.min(width - left, Math.round(mask.w * width)));
    const maskHeight = Math.max(1, Math.min(height - top, Math.round(mask.h * height)));
    const patch = await sharp({
      create: {
        width: maskWidth,
        height: maskHeight,
        channels: 3,
        background: { r: 20, g: 18, b: 34 },
      },
    })
      .png()
      .toBuffer();
    pipeline = pipeline.composite([{ input: patch, left, top }]);
  }

  return pipeline.jpeg({ quality: 82 }).toBuffer();
};

/** A file name holding a path separator, a parent hop or a NUL byte is refused. */
export const fileNameIsRefused = (fileName: string): boolean =>
  fileName.includes('/') || fileName.includes('\\') || fileName.includes('..') || fileName.includes('\u0000');
