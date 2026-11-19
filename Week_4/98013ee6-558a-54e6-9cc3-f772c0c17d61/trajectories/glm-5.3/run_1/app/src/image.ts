import sharp from "sharp";
import { createHash } from "node:crypto";
import { config } from "./config";
import { tooLarge, unsupportedType, validation } from "./errors";

export const DISPLAY_WIDTHS = [236, 474, 736];

export interface ProcessedImage {
  format: "png" | "jpeg";
  width: number;
  height: number;
  sha256: string;
  original: Buffer;
  variants: { width: number; bytes: Buffer }[];
}

/** Reads type from the first bytes, applies orientation, strips every metadata block (DP-22). */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  const type = sniffType(input);
  if (!type) throw unsupportedType();
  if (input.length > config.imageMaxBytes) throw tooLarge(config.imageMaxBytes);

  const upright = sharp(input, { failOn: "none" }).rotate().toColorspace("srgb");
  const info = await upright.toBuffer({ resolveWithObject: true });
  const w = info.info.width ?? 0;
  const h = info.info.height ?? 0;
  if (w * h > config.imageMaxPixels) throw validation("image");
  const ratio = h === 0 ? 0 : w / h;
  if (ratio < 0.5 || ratio > 2.0) throw validation("image");

  // Decode upright pixels for the content hash: 8-bit RGBA in row order.
  const rgba = await sharp(input, { failOn: "none" }).rotate().ensureAlpha().raw().toBuffer();
  const sha256 = createHash("sha256").update(rgba).digest("hex");

  const encoded = await upright.toFormat(type, { quality: 90 }).toBuffer();
  const variants: { width: number; bytes: Buffer }[] = [];
  for (const vw of DISPLAY_WIDTHS) {
    if (vw > w) break;
    variants.push({ width: vw, bytes: await sharp(encoded).resize({ width: vw }).toFormat(type, { quality: 90 }).toBuffer() });
  }
  return { format: type, width: w, height: h, sha256, original: encoded, variants };
}

/** A solid test image in a given format, used by the seed routes (DP-04, DP-91). */
export async function solidImage(width: number, height: number, format: "png" | "jpeg", color: string): Promise<ProcessedImage> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${color}"/></svg>`
  );
  const buf = await sharp(svg).toFormat(format === "png" ? "png" : "jpeg", { quality: 90 }).toBuffer();
  return processUpload(buf);
}

function sniffType(buf: Buffer): "png" | "jpeg" | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}
