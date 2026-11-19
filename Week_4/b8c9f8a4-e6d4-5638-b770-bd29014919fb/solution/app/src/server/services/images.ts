// Uploads are judged by their bytes, and the buyer's copy is a separate upright JPEG with no
// metadata and the owner's plate mask burned in.

import sharp from 'sharp';
import { readExif } from './exif.js';

type FileKind = 'jpeg' | 'png' | 'pdf';

const LONG_EDGE = 1600;
/** One solid dark colour, well under the brightness a photograph would show through. */
const MASK_COLOUR = { r: 18, g: 18, b: 26 };

export interface PlateMask {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the bytes actually are, whatever the name or the declared type says. */
export function sniff(file: Buffer): FileKind | null {
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) return 'jpeg';
  if (file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (file.length >= 5 && file.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

interface Upright {
  width: number;
  height: number;
}

/** A picture must decode fully; a truncated or crafted file does not. */
export async function readPicture(file: Buffer): Promise<Upright | null> {
  try {
    const image = sharp(file, { failOn: 'truncated', animated: false });
    const facts = await image.metadata();
    if (!facts.width || !facts.height) return null;
    const raw = await image.rotate().raw().toBuffer({ resolveWithObject: true });
    if (!raw.info.width || !raw.info.height) return null;
    return { width: raw.info.width, height: raw.info.height };
  } catch {
    return null;
  }
}

export function hasLocation(file: Buffer): boolean {
  return sniff(file) === 'jpeg' && readExif(file).hasLocation;
}

/**
 * The buyer's copy: turned upright, scaled so its long edge is at most 1600 pixels, stripped of
 * every piece of metadata, with the mask rectangle filled in one solid dark colour.
 */
export async function makeDerivative(file: Buffer, mask: PlateMask | null): Promise<Buffer> {
  const upright = sharp(file, { failOn: 'truncated' }).rotate();
  const facts = await upright.metadata();
  // readPicture refused pictures without a size
  const width = facts.width as number;
  const height = facts.height as number;
  const turned = (facts.orientation ?? 1) >= 5;
  const uprightWidth = turned ? height : width;
  const uprightHeight = turned ? width : height;
  const scale = Math.min(1, LONG_EDGE / Math.max(uprightWidth, uprightHeight));
  const finalWidth = Math.max(1, Math.round(uprightWidth * scale));
  const finalHeight = Math.max(1, Math.round(uprightHeight * scale));

  let pipeline = sharp(file, { failOn: 'truncated' })
    .rotate()
    .resize({ width: finalWidth, height: finalHeight, fit: 'fill' });

  if (mask) {
    const left = Math.max(0, Math.min(finalWidth - 1, Math.round(mask.x * finalWidth)));
    const top = Math.max(0, Math.min(finalHeight - 1, Math.round(mask.y * finalHeight)));
    const maskWidth = Math.max(1, Math.min(finalWidth - left, Math.round(mask.w * finalWidth)));
    const maskHeight = Math.max(1, Math.min(finalHeight - top, Math.round(mask.h * finalHeight)));
    const patch = await sharp({
      create: { width: maskWidth, height: maskHeight, channels: 3, background: MASK_COLOUR },
    })
      .png()
      .toBuffer();
    pipeline = pipeline.composite([{ input: patch, left, top }]);
  }

  return pipeline.jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: false }).toBuffer();
}
