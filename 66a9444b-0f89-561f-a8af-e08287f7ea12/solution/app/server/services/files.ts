// Uploaded files are judged by their leading bytes and size, never by their name or declared type.
import webp from "@cwasm/webp";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { FieldErrors, type UploadedFile } from "../http.ts";

type SniffedType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

function sniff(data: Buffer): SniffedType | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const NAME_LIMIT = 200;

/** Any name holding /, \, .., a control character, or longer than 200 characters is refused. */
function nameAllowed(name: string): boolean {
  return name.length <= NAME_LIMIT && !/[/\\]/.test(name) && !name.includes("..") && !/[\u0000-\u001f\u007f]/.test(name);
}

/** The file field's checks shared by proofs and artwork: required, non-empty, allowed name, allowed type. */
export function checkUpload(file: UploadedFile | null, allowed: readonly SniffedType[]): { file: UploadedFile; type: SniffedType } | { error: string } {
  if (!file) return { error: "required" };
  if (file.data.length === 0) return { error: "empty" };
  if (!nameAllowed(file.filename)) return { error: "invalid_name" };
  const type = sniff(file.data);
  if (!type || !allowed.includes(type)) return { error: "unsupported_type" };
  return { file, type };
}

type Pixels = { width: number; height: number; data: Uint8Array };

/** Decodes an image fully; an image that does not decode is refused as unsupported_type. */
export function decodeImage(data: Buffer, type: SniffedType): Pixels {
  try {
    if (type === "image/png") {
      const png = PNG.sync.read(data);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (type === "image/jpeg") {
      const image = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
      return { width: image.width, height: image.height, data: image.data };
    }
    const image = webp.decode(data);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength) };
  } catch {
    throw new FieldErrors({ file: "unsupported_type" });
  }
}

const DISPLAY_LONGEST = 1200;

/** The display copy: a JPEG whose longest side is at most 1200 pixels (box-filtered down, never up). */
export function displayJpeg(source: Pixels): Buffer {
  const scale = Math.min(1, DISPLAY_LONGEST / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y / scale);
    const sy1 = Math.max(sy0 + 1, Math.min(source.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x / scale);
      const sx1 = Math.max(sx0 + 1, Math.min(source.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * source.width + sx) * 4;
          const alpha = source.data[i + 3]! / 255;
          // Transparent pixels sit on the festival's paper colour.
          r += source.data[i]! * alpha + 244 * (1 - alpha);
          g += source.data[i + 1]! * alpha + 237 * (1 - alpha);
          b += source.data[i + 2]! * alpha + 225 * (1 - alpha);
          a += 255;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return Buffer.from(jpeg.encode({ width, height, data: out }, 86).data);
}
