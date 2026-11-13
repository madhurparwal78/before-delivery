import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { COPY, invalid, refuse } from "./errors.js";

// Case-study image checks, in the brief's order, and the re-encode that is the only thing ever stored
// (brief: Business rules, Images).

const MAX_UPLOAD_BYTES = 8000000;
const MAX_IMAGES = 6;
const MIN_SIDE = 640;
const MAX_SIDE = 4096;

interface CheckedImage {
  type: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
  width: number;
  height: number;
  data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

interface Pixels {
  width: number;
  height: number;
  data: Buffer | Uint8Array;
  alpha: boolean;
}

/** The PNG up to the end of its IEND chunk; bytes after the image data are dropped, never decoded or kept. */
function pngStream(data: Buffer): Buffer {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    offset += 12 + length;
    if (type === "IEND") return data.subarray(0, Math.min(offset, data.length));
  }
  return data;
}

function decode(data: Buffer, kind: "png" | "jpg"): Pixels {
  try {
    if (kind === "png") {
      const png = PNG.sync.read(pngStream(data));
      return { width: png.width, height: png.height, data: png.data, alpha: png.alpha };
    }
    const image = jpeg.decode(data, { useTArray: true, maxMemoryUsageInMB: 512, maxResolutionInMP: 32 });
    return { width: image.width, height: image.height, data: image.data, alpha: false };
  } catch {
    throw invalid({ file: COPY.unreadable });
  }
}

/** Checks one uploaded file against size, signature, decoding, dimensions and the per-entry count. */
export function checkImage(data: Buffer, imagesOnEntry: number): CheckedImage {
  if (data.length > MAX_UPLOAD_BYTES) throw refuse("file_too_large");
  const kind = data.subarray(0, 8).equals(PNG_SIGNATURE) ? "png"
    : data.subarray(0, 3).equals(JPEG_SIGNATURE) ? "jpg" : null;
  if (!kind) throw refuse("unsupported_type");
  const pixels = decode(data, kind);
  const sides = [pixels.width, pixels.height];
  if (sides.some((side) => side < MIN_SIDE || side > MAX_SIDE)) throw invalid({ file: COPY.dimensions });
  if (imagesOnEntry >= MAX_IMAGES) throw invalid({ file: COPY.count });
  return kind === "png"
    ? { type: "image/png", extension: "png", width: pixels.width, height: pixels.height, data: encodePng(pixels) }
    : { type: "image/jpeg", extension: "jpg", width: pixels.width, height: pixels.height,
      data: Buffer.from(jpeg.encode({ width: pixels.width, height: pixels.height, data: pixels.data }, 90).data) };
}

/** A fresh PNG from decoded pixels: no metadata chunks and nothing after the image data. */
export function encodePng(pixels: Pixels): Buffer {
  const png = new PNG({ width: pixels.width, height: pixels.height, colorType: pixels.alpha ? 6 : 2, inputHasAlpha: true });
  png.data = Buffer.from(pixels.data);
  return PNG.sync.write(png, { colorType: pixels.alpha ? 6 : 2, inputHasAlpha: true });
}
