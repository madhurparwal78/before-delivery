// Upright pixel pipeline: decode, orient, swatch areas, display crop.
// Uses jpeg-js and pngjs (pure JS, permissive licences); the display crop is
// written as a stripped PNG... JPEG is required, so the crop is encoded with
// jpeg-js and carries no metadata at all.

import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { sniffPhotoType, type PhotoHeader, readPhotoHeader } from "./photo.js";
import { p3ToSrgb, swatchHex } from "./swatch.js";

export interface UprightImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
  profileDescription: string | null;
}

// EXIF profile description probe: enough to read "Display P3" from an ICC block.
function readProfileDescription(buf: Buffer): string | null {
  // Search for the ICC profile marker APP2 "ICC_PROFILE" in JPEG; PNG gives up
  // metadata bytes to pngjs which strips them, so PNG is treated as sRGB unless
  // an iCCP chunk name mentions P3 (pngjs drops it; kept sRGB by rule default).
  const idx = buf.indexOf(Buffer.from("ICC_PROFILE", "latin1"));
  if (idx < 0) return null;
  const icc = buf.subarray(idx, Math.min(idx + 4096, buf.length));
  // ICC description lives in the 'desc' tag; a plain-text scan is sufficient
  // for the single published case ("Display P3").
  const text = icc.toString("latin1");
  const p3 = /Display\s*P3/.exec(text);
  return p3 ? p3[0].replace(/\s+/g, " ") : null;
}

function decodeJpeg(buf: Buffer): UprightImage {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data), profileDescription: readProfileDescription(buf) };
}

function decodePng(buf: Buffer): UprightImage {
  const raw = PNG.sync.read(buf);
  return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data), profileDescription: null };
}

// Orient pixels to upright using the orientation tag (1..8).
export function upright(buf: Buffer): UprightImage | null {
  const kind = sniffPhotoType(buf);
  if (kind === null) return null;
  let decoded: UprightImage;
  try {
    decoded = kind === "jpeg" ? decodeJpeg(buf) : decodePng(buf);
  } catch {
    return null;
  }
  const orientation = (readPhotoHeader(buf) as PhotoHeader | null)?.orientation ?? 1;
  if (orientation === 1) return decoded;
  const { width, height, data } = decoded;
  const out = new Uint8Array(width * height * 4);
  const put = (sx: number, sy: number, dx: number, dy: number) => {
    const si = (sy * width + sx) * 4, di = (dy * (orientation >= 5 ? height : width) + dx) * 4;
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      switch (orientation) {
        case 2: put(x, y, width - 1 - x, y); break;
        case 3: put(x, y, width - 1 - x, height - 1 - y); break;
        case 4: put(x, y, x, height - 1 - y); break;
        case 5: put(x, y, y, x); break;
        case 6: put(x, y, height - 1 - y, x); break;
        case 7: put(x, y, height - 1 - y, width - 1 - x); break;
        case 8: put(x, y, y, width - 1 - x); break;
      }
    }
  }
  const w = orientation >= 5 ? height : width;
  const h = orientation >= 5 ? width : height;
  return { width: w, height: h, data: out, profileDescription: decoded.profileDescription };
}

// The published mean rule over an area, with alpha-0 pixels left out and
// Display P3 converted to sRGB.
export function swatchForArea(img: UprightImage, x0: number, y0: number, x1: number, y1: number): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2];
      n++;
    }
  }
  if (n === 0) return swatchHex(0, 0, 0);
  const mr = r / n, mg = g / n, mb = b / n;
  if (img.profileDescription && /Display P3/i.test(img.profileDescription)) {
    const [cr, cg, cb] = p3ToSrgb(mr, mg, mb);
    return swatchHex(cr, cg, cb);
  }
  return swatchHex(Math.round(mr), Math.round(mg), Math.round(mb));
}

// Computed swatch: the centred rectangle half the width and half the height.
export function computedSwatch(img: UprightImage): string {
  const x0 = Math.floor(img.width * 0.25), x1 = Math.ceil(img.width * 0.75) - 1;
  const y0 = Math.floor(img.height * 0.25), y1 = Math.ceil(img.height * 0.75) - 1;
  return swatchForArea(img, x0, y0, x1, y1);
}

// Eyedropper swatch: the 5x5 box centred on the point, clipped to the image.
export function eyedropperSwatch(img: UprightImage, x: number, y: number): string {
  const cx = Math.round(x * (img.width - 1));
  const cy = Math.round(y * (img.height - 1));
  const x0 = Math.max(0, Math.min(img.width - 1, cx - 2));
  const x1 = Math.max(0, Math.min(img.width - 1, cx + 2));
  const y0 = Math.max(0, Math.min(img.height - 1, cy - 2));
  const y1 = Math.max(0, Math.min(img.height - 1, cy + 2));
  return swatchForArea(img, x0, y0, x1, y1);
}

// A square centred crop of the upright image, converted to sRGB, encoded as a
// clean JPEG with no orientation tag, EXIF, XMP, GPS, comment or profile.
export function displayCrop(img: UprightImage): Buffer {
  const side = Math.min(1200, Math.min(img.width, img.height));
  const left = Math.floor((img.width - side) / 2);
  const top = Math.floor((img.height - side) / 2);
  const data = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const src = ((top + y) * img.width + left + x) * 4;
      const dst = (y * side + x) * 4;
      data[dst] = img.data[src];
      data[dst + 1] = img.data[src + 1];
      data[dst + 2] = img.data[src + 2];
      data[dst + 3] = img.data[src + 3];
    }
  }
  return jpeg.encode({ data, width: side, height: side }, 85).data as unknown as Buffer;
}
