import sharp from 'sharp';
import decodeHeic from 'heic-decode';

/**
 * Hoof photos. A file is accepted only when its bytes begin with a JPEG, PNG or HEIC
 * signature and decode as a complete image; the file name and declared type are
 * ignored. Any declared orientation is applied to the pixels before every scrap of
 * metadata is dropped, so the stored image displays upright exactly as the upload did.
 */
export class UnsupportedImage extends Error {
  constructor() {
    super('unsupported image');
    this.name = 'UnsupportedImage';
  }
}

export type ImageSignature = 'jpeg' | 'png' | 'heic';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1']);

export function signatureOf(bytes: Buffer): ImageSignature | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('latin1');
    if (HEIC_BRANDS.has(brand)) return 'heic';
  }
  return null;
}

export interface StoredImage {
  bytes: Buffer;
  contentType: string;
  extension: 'jpg' | 'png';
  width: number;
  height: number;
}

/**
 * Validates, uprights and strips an upload. The image is never otherwise scaled or
 * cropped, so the stored width and height are the upload's pixel size, swapped when
 * the declared orientation turns it.
 */
export async function prepareStoredImage(bytes: Buffer): Promise<StoredImage> {
  const signature = signatureOf(bytes);
  if (signature === null) throw new UnsupportedImage();

  if (signature === 'heic') {
    let decoded: { width: number; height: number; data: ArrayBufferLike };
    try {
      decoded = await decodeHeic({ buffer: new Uint8Array(bytes) });
    } catch {
      throw new UnsupportedImage();
    }
    const raw = sharp(Buffer.from(decoded.data), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    });
    const output = await raw.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return {
      bytes: output.data,
      contentType: 'image/jpeg',
      extension: 'jpg',
      width: output.info.width,
      height: output.info.height,
    };
  }

  try {
    const pipeline = sharp(bytes, { failOn: 'error' }).rotate();
    const output =
      signature === 'jpeg'
        ? await pipeline.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true })
        : await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    return {
      bytes: output.data,
      contentType: signature === 'jpeg' ? 'image/jpeg' : 'image/png',
      extension: signature === 'jpeg' ? 'jpg' : 'png',
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof UnsupportedImage) throw error;
    throw new UnsupportedImage();
  }
}

/** A 320-pixel-wide JPEG with no metadata. The stored photo is never altered. */
export async function makeThumbnail(bytes: Buffer): Promise<Buffer> {
  return await sharp(bytes).resize({ width: 320 }).jpeg({ quality: 80 }).toBuffer();
}
