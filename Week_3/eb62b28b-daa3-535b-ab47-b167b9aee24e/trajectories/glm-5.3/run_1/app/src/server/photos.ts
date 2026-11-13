import { Jimp } from "jimp";

export type SniffKind = "pdf" | "jpeg" | "png" | "other";

/** Judge a file by its first bytes, never by its name or declared type. */
export function sniffKind(bytes: Buffer): SniffKind {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  return "other";
}

/**
 * Cleaned photo copy: apply the camera orientation to the pixels and strip
 * every metadata block (EXIF, GPS, XMP, ICC profile text, comments, text chunks).
 * Jimp reads only pixel data and its EXIF orientation on read, so its output
 * carries no metadata at all.
 */
export async function cleanedPhotoCopy(original: Buffer): Promise<Buffer> {
  const image = await Jimp.fromBuffer(original);
  return image.getBuffer("image/jpeg", { quality: 88 });
}
