import { createHash } from "node:crypto";
import { ApiError, invalid } from "./errors";

export const SHEET_MAX_BYTES = 5_000_000;
export const SHEET_TYPES = ["image/png", "image/jpeg"] as const;
export type SheetType = (typeof SHEET_TYPES)[number];
const DIMENSION_MIN = 200;
const DIMENSION_MAX = 4000;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_START = Buffer.from([255, 216, 255]);
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2]);

interface Dimensions {
  width: number;
  height: number;
}

function pngDimensions(bytes: Buffer): Dimensions | null {
  const header = bytes.subarray(8, 8 + 8 + 8);
  if (header.length < 16 || header.toString("latin1", 4, 8) !== "IHDR") return null;
  return { width: header.readUInt32BE(8), height: header.readUInt32BE(12) };
}

function jpegDimensions(bytes: Buffer): Dimensions | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    if (START_OF_FRAME.has(marker)) {
      if (at + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

interface CheckedSheet {
  contentType: SheetType;
  bytes: Buffer;
  sha256: string;
  extension: "png" | "jpg";
  width: number;
  height: number;
}

/**
 * The one place that judges an uploaded sheet: empty body, then the bytes against the
 * declared type, then the pixel dimensions.
 */
export function checkSheet(bytes: Buffer, contentType: SheetType): CheckedSheet {
  if (bytes.length === 0) throw invalid({ body: "required" });
  const signature = contentType === "image/png" ? PNG_SIGNATURE : JPEG_START;
  if (!bytes.subarray(0, signature.length).equals(signature)) {
    throw new ApiError(415, { error: "unsupported_media_type" });
  }
  const size = contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  const inRange = (side: number) => side >= DIMENSION_MIN && side <= DIMENSION_MAX;
  if (size === null || !inRange(size.width) || !inRange(size.height)) throw invalid({ body: "invalid" });
  return {
    contentType,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    extension: contentType === "image/png" ? "png" : "jpg",
    width: size.width,
    height: size.height,
  };
}
