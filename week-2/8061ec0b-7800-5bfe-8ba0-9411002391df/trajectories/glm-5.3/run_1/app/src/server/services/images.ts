// Condition photo processing (DP-34): judged by content, re-encoded as JPEG
// at the source pixel size, all metadata removed. The codecs are pure
// JS/WASM under BSD, MIT and Apache licences.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { decode as decodeWebp } from "@jsquash/webp";

export interface PhotoCheck {
  ok: boolean;
  code?: "photo_too_large" | "unsupported_image" | "dimensions";
  message?: string;
}

export function checkPhotoSize(bytes: number): PhotoCheck {
  if (bytes > 5_000_000) {
    return { ok: false, code: "photo_too_large", message: "over 5,000,000 bytes" };
  }
  return { ok: true };
}

function sniffFormat(data: Buffer): "jpeg" | "png" | "webp" | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "jpeg";
  }
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

interface Decoded {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function decodeToRgba(data: Buffer): Decoded | null {
  const format = sniffFormat(data);
  try {
    if (format === "jpeg") {
      const decoded = jpeg.decode(data, { useTArray: true });
      return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
    }
    if (format === "png") {
      const decoded = PNG.sync.read(data);
      if (decoded.data.length === decoded.width * decoded.height * 4) {
        return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
      }
      const rgba = new Uint8Array(decoded.width * decoded.height * 4);
      for (let i = 0, j = 0; i < decoded.data.length; i += 3, j += 4) {
        rgba[j] = decoded.data[i];
        rgba[j + 1] = decoded.data[i + 1];
        rgba[j + 2] = decoded.data[i + 2];
        rgba[j + 3] = 255;
      }
      return { width: decoded.width, height: decoded.height, rgba };
    }
    return null;
  } catch {
    return null;
  }
}

function toWebpInput(data: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

export async function checkPhotoContent(data: Buffer): Promise<PhotoCheck> {
  const format = sniffFormat(data);
  if (format === null) {
    return { ok: false, code: "unsupported_image", message: "not a JPEG, PNG or WebP photo" };
  }
  if (format === "webp") {
    try {
      const image = await decodeWebp(toWebpInput(data));
      if (image.width > 8000 || image.height > 8000) {
        return { ok: false, code: "dimensions", message: "over 8,000 pixels on a side" };
      }
      return { ok: true };
    } catch {
      return { ok: false, code: "unsupported_image", message: "not a JPEG, PNG or WebP photo" };
    }
  }
  const decoded = decodeToRgba(data);
  if (!decoded) {
    return { ok: false, code: "unsupported_image", message: "not a JPEG, PNG or WebP photo" };
  }
  if (decoded.width > 8000 || decoded.height > 8000) {
    return { ok: false, code: "dimensions", message: "over 8,000 pixels on a side" };
  }
  return { ok: true };
}

// Re-encoded as JPEG at the same pixel width and height as the source, with
// all metadata removed (the encoder writes none).
export async function reencodeAsJpeg(data: Buffer): Promise<Buffer> {
  const format = sniffFormat(data);
  let decoded: Decoded;
  if (format === "webp") {
    const image = await decodeWebp(toWebpInput(data));
    decoded = { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
  } else {
    const syncDecoded = decodeToRgba(data);
    if (!syncDecoded) throw new Error("photo failed to decode");
    decoded = syncDecoded;
  }
  // Composite onto white, dropping the alpha channel.
  const rgb = Buffer.alloc(decoded.width * decoded.height * 3);
  for (let i = 0, j = 0; i < decoded.rgba.length; i += 4, j += 3) {
    const alpha = decoded.rgba[i + 3] / 255;
    rgb[j] = Math.round(decoded.rgba[i] * alpha + 255 * (1 - alpha));
    rgb[j + 1] = Math.round(decoded.rgba[i + 1] * alpha + 255 * (1 - alpha));
    rgb[j + 2] = Math.round(decoded.rgba[i + 2] * alpha + 255 * (1 - alpha));
  }
  const encoded = jpeg.encode({ data: rgb, width: decoded.width, height: decoded.height }, 82);
  return Buffer.from(encoded.data);
}
