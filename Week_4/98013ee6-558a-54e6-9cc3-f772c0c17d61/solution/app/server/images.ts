import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { VARIANT_WIDTHS } from "./config.js";

export type ImageFormat = "png" | "jpeg";

export interface ProcessedImage {
  format: ImageFormat;
  width: number;
  height: number;
  sha256: string;
  original: Buffer;
  variants: { width: number; data: Buffer }[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type is decided from the file's first bytes, never from its name or declared type. */
export function sniffFormat(data: Buffer): ImageFormat | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  return null;
}

export const extensionOf = (format: ImageFormat): string => (format === "png" ? "png" : "jpg");
export const contentTypeOf = (format: ImageFormat): string => (format === "png" ? "image/png" : "image/jpeg");

/** Width and height as displayed, after the orientation is applied. Null when the bytes do not decode. */
export async function uprightSize(data: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return null;
    const turned = (meta.orientation ?? 1) >= 5;
    return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

function encode(pipeline: Sharp, format: ImageFormat): Sharp {
  return format === "png" ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 90 });
}

/** Hashes the decoded pixels and renders the original and the display widths from an upright pipeline. */
async function render(upright: Sharp, format: ImageFormat): Promise<ProcessedImage> {
  const { data: pixels, info } = await upright.clone().ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  const sha256 = createHash("sha256").update(pixels).digest("hex");
  const original = await encode(upright.clone(), format).toBuffer();
  const variants = await Promise.all(
    VARIANT_WIDTHS.filter((width) => width <= info.width).map(async (width) => ({
      width,
      data: await encode(sharp(original).resize({ width }), format).toBuffer(),
    })),
  );
  return { format, width: info.width, height: info.height, sha256, original, variants };
}

/** An uploaded file: turned upright by its orientation, every metadata block removed. */
export const processImage = (data: Buffer, format: ImageFormat): Promise<ProcessedImage> => render(sharp(data).rotate(), format);

/** A solid image of the given size, format and colour, for the grading seed and the demo content. */
export const processSolid = (width: number, height: number, format: ImageFormat, color: string): Promise<ProcessedImage> =>
  render(sharp({ create: { width, height, channels: 3, background: color } }), format);
