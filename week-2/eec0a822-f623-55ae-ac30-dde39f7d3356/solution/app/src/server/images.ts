// Passport photos: accepted only when the content decodes as JPEG or PNG; stored re-encoded with the camera
// orientation applied to the pixels and no metadata (brief: Services, MinIO).
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

interface Photo {
  data: Buffer;
  extension: "jpg" | "png";
  contentType: "image/jpeg" | "image/png";
}

interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The EXIF orientation (1..8) inside a TIFF block, or 1. */
function tiffOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function jpegOrientation(data: Buffer): number {
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.readUInt16BE(at + 2);
    if (marker === 0xe1 && data.toString("latin1", at + 4, at + 10) === "Exif\0\0") {
      return tiffOrientation(data.subarray(at + 10, at + 2 + length));
    }
    at += 2 + length;
  }
  return 1;
}

function pngOrientation(data: Buffer): number {
  let at = 8;
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString("latin1", at + 4, at + 8);
    if (type === "eXIf") return tiffOrientation(data.subarray(at + 8, at + 8 + length));
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  return 1;
}

/** Applies an EXIF orientation to RGBA pixels; sideways orientations swap width and height. */
function orient(src: Raster, orientation: number): Raster {
  if (orientation === 1) return src;
  const { width: w, height: h } = src;
  const sideways = orientation >= 5;
  const out = { width: sideways ? h : w, height: sideways ? w : h, data: new Uint8Array(src.data.length) };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [dx, dy] = {
        2: [w - 1 - x, y],
        3: [w - 1 - x, h - 1 - y],
        4: [x, h - 1 - y],
        5: [y, x],
        6: [h - 1 - y, x],
        7: [h - 1 - y, w - 1 - x],
        8: [y, w - 1 - x],
      }[orientation] as [number, number];
      const from = (y * w + x) * 4;
      const to = (dy * out.width + dx) * 4;
      out.data[to] = src.data[from];
      out.data[to + 1] = src.data[from + 1];
      out.data[to + 2] = src.data[from + 2];
      out.data[to + 3] = src.data[from + 3];
    }
  }
  return out;
}

/** The stored form of an uploaded photo, or null when the content is not a JPEG or PNG image. */
export function processPhoto(data: Buffer): Photo | null {
  try {
    if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) {
      const decoded = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 768 });
      const raster = orient({ width: decoded.width, height: decoded.height, data: decoded.data }, jpegOrientation(data));
      const encoded = jpeg.encode({ width: raster.width, height: raster.height, data: Buffer.from(raster.data) }, 90);
      return { data: Buffer.from(encoded.data), extension: "jpg", contentType: "image/jpeg" };
    }
    if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      const decoded = PNG.sync.read(data);
      const raster = orient({ width: decoded.width, height: decoded.height, data: decoded.data }, pngOrientation(data));
      const out = new PNG({ width: raster.width, height: raster.height });
      out.data = Buffer.from(raster.data);
      return { data: PNG.sync.write(out), extension: "png", contentType: "image/png" };
    }
  } catch {
    return null;
  }
  return null;
}
