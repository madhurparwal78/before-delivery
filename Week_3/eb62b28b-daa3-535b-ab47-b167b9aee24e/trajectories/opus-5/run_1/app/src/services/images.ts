import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export type PhotoKind = 'jpeg' | 'png';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF-');

/** Attachments are judged by their first bytes, never by name or declared type. */
export function attachmentKind(bytes: Buffer): 'pdf' | PhotoKind | null {
  if (bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';
  if (bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'jpeg';
  if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'png';
  return null;
}

/** The camera orientation from the EXIF APP1 block, or 1 when there is none. */
export function exifOrientation(bytes: Buffer): number {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).toString('latin1') === 'Exif\0\0') {
      const tiff = offset + 10;
      const littleEndian = bytes.subarray(tiff, tiff + 2).toString('latin1') === 'II';
      const readShort = (at: number): number =>
        littleEndian ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
      const readLong = (at: number): number =>
        littleEndian ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
      const ifdOffset = readLong(tiff + 4);
      const entryCount = readShort(tiff + ifdOffset);
      for (let index = 0; index < entryCount; index += 1) {
        const entry = tiff + ifdOffset + 2 + index * 12;
        if (readShort(entry) === 0x0112) return readShort(entry + 8);
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

interface Raster {
  width: number;
  height: number;
  data: Buffer;
}

function applyOrientation(image: Raster, orientation: number): Raster {
  if (orientation <= 1 || orientation > 8) return image;
  const swapped = orientation >= 5;
  const width = swapped ? image.height : image.width;
  const height = swapped ? image.width : image.height;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let targetX = x;
      let targetY = y;
      switch (orientation) {
        case 2:
          targetX = image.width - 1 - x;
          break;
        case 3:
          targetX = image.width - 1 - x;
          targetY = image.height - 1 - y;
          break;
        case 4:
          targetY = image.height - 1 - y;
          break;
        case 5:
          targetX = y;
          targetY = x;
          break;
        case 6:
          targetX = image.height - 1 - y;
          targetY = x;
          break;
        case 7:
          targetX = image.height - 1 - y;
          targetY = image.width - 1 - x;
          break;
        case 8:
          targetX = y;
          targetY = image.width - 1 - x;
          break;
        default:
          break;
      }
      const from = (y * image.width + x) * 4;
      const to = (targetY * width + targetX) * 4;
      image.data.copy(data, to, from, from + 4);
    }
  }
  return { width, height, data };
}

/** Re-encodes a photo with the orientation applied and every metadata block dropped. */
export function cleanPhoto(kind: PhotoKind, bytes: Buffer): Buffer {
  if (kind === 'jpeg') {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    const upright = applyOrientation(
      { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) },
      exifOrientation(bytes),
    );
    const encoded = jpeg.encode(
      { data: upright.data, width: upright.width, height: upright.height },
      90,
    );
    return Buffer.from(encoded.data);
  }
  const source = PNG.sync.read(bytes);
  const clean = new PNG({ width: source.width, height: source.height });
  Buffer.from(source.data).copy(clean.data);
  return PNG.sync.write(clean);
}
