import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { decode as decodeWebp } from "@jsquash/webp";

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function sniffImageType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

// A successful decode: the leading bytes must name a supported type and the
// full pixel data must come out of it.
export async function decodeImage(type: string, bytes: Buffer): Promise<DecodedImage> {
  if (type === "image/jpeg") {
    const decoded = jpeg.decode(bytes, { useTArray: true, tolerantDecoding: false });
    return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
  }
  if (type === "image/png") {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  if (type === "image/webp") {
    const decoded = await decodeWebp(new Uint8Array(bytes));
    return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
  }
  throw new Error("unsupported type");
}

// Bilinear resample so the longest side fits within the limit.
export function resizeLongest(image: DecodedImage, limit: number): DecodedImage {
  const { width, height, data } = image;
  const longest = Math.max(width, height);
  if (longest <= limit) return image;
  const scale = limit / longest;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcY = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(srcY)));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, srcY - y0));
    for (let x = 0; x < w; x += 1) {
      const srcX = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(srcX)));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, srcX - x0));
      for (let c = 0; c < 4; c += 1) {
        const a = data[(y0 * width + x0) * 4 + c];
        const b = data[(y0 * width + x1) * 4 + c];
        const d = data[(y1 * width + x0) * 4 + c];
        const e = data[(y1 * width + x1) * 4 + c];
        const top = a + (b - a) * fx;
        const bottom = d + (e - d) * fx;
        out[(y * w + x) * 4 + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { width: w, height: h, data: out };
}

export function encodeJpeg(image: DecodedImage, quality = 82): Buffer {
  const encoded = jpeg.encode({ width: image.width, height: image.height, data: Buffer.from(image.data) }, quality);
  return Buffer.from(encoded.data);
}
