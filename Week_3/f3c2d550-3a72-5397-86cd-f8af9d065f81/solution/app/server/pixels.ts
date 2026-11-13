import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { BLACK, screenColour, toHex, type Rgb } from "./colour.js";
import type { PhotoHeader } from "./photo.js";

export interface MeasureRequest {
  bytes: Uint8Array;
  header: PhotoHeader;
  /** An eyedropper point on the upright image, fractions 0 to 1. */
  point: { x: number; y: number } | null;
  /** Whether to make the display crop. */
  crop: boolean;
}

export interface Measurement {
  computed: string;
  sampled: string | null;
  display: Uint8Array | null;
}

const DISPLAY_SIDE = 1200;
const DISPLAY_QUALITY = 90;
const EYEDROPPER_RADIUS = 2;

interface Raster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function decode(bytes: Uint8Array, type: PhotoHeader["type"]): Raster {
  if (type === "png") {
    const { width, height, data } = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
    return { width, height, rgba: data };
  }
  const { width, height, data } = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 4096,
    maxResolutionInMP: 100,
  });
  return { width, height, rgba: data };
}

/** Index strides that read the upright image out of the stored pixels for each orientation tag. */
function uprightIndexing(orientation: number, storedWidth: number, storedHeight: number) {
  const coefficients: Record<number, readonly [number, number, number, number, number, number]> = {
    // sx0, ax, bx, sy0, ay, by with sx = sx0 + ax*ux + bx*uy and sy = sy0 + ay*ux + by*uy
    1: [0, 1, 0, 0, 0, 1],
    2: [storedWidth - 1, -1, 0, 0, 0, 1],
    3: [storedWidth - 1, -1, 0, storedHeight - 1, 0, -1],
    4: [0, 1, 0, storedHeight - 1, 0, -1],
    5: [0, 0, 1, 0, 1, 0],
    6: [0, 0, 1, storedHeight - 1, -1, 0],
    7: [storedWidth - 1, 0, -1, storedHeight - 1, -1, 0],
    8: [storedWidth - 1, 0, -1, 0, 1, 0],
  };
  const [sx0, ax, bx, sy0, ay, by] = coefficients[orientation] ?? coefficients[1] ?? [0, 1, 0, 0, 0, 1];
  return {
    base: (sy0 * storedWidth + sx0) * 4,
    perColumn: (ay * storedWidth + ax) * 4,
    perRow: (by * storedWidth + bx) * 4,
  };
}

function meanOver(
  raster: Raster,
  header: PhotoHeader,
  area: { x0: number; y0: number; x1: number; y1: number },
): Rgb | null {
  const { base, perColumn, perRow } = uprightIndexing(header.orientation, raster.width, raster.height);
  let red = 0;
  let green = 0;
  let blue = 0;
  let counted = 0;
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      const at = base + x * perColumn + y * perRow;
      if (raster.rgba[at + 3] === 0) continue;
      red += raster.rgba[at] ?? 0;
      green += raster.rgba[at + 1] ?? 0;
      blue += raster.rgba[at + 2] ?? 0;
      counted += 1;
    }
  }
  return counted === 0 ? null : { red: red / counted, green: green / counted, blue: blue / counted };
}

function swatchOver(raster: Raster, header: PhotoHeader, area: { x0: number; y0: number; x1: number; y1: number }): string {
  const mean = meanOver(raster, header, area);
  return toHex(mean ? screenColour(mean, header.displayP3) : BLACK);
}

function hexToRgb(hex: string): Rgb {
  return { red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16) };
}

/** A centred square of the upright image, averaged down to at most 1200 pixels a side, as JPEG. */
function displayCrop(raster: Raster, header: PhotoHeader, background: Rgb): Uint8Array {
  const { base, perColumn, perRow } = uprightIndexing(header.orientation, raster.width, raster.height);
  const side = Math.min(header.width, header.height);
  const output = Math.min(DISPLAY_SIDE, side);
  const left = Math.floor((header.width - side) / 2);
  const top = Math.floor((header.height - side) / 2);
  const pixels = Buffer.alloc(output * output * 4, 255);
  for (let oy = 0; oy < output; oy += 1) {
    const fromY = top + Math.floor((oy * side) / output);
    const toY = top + Math.max(Math.floor(((oy + 1) * side) / output), Math.floor((oy * side) / output) + 1);
    for (let ox = 0; ox < output; ox += 1) {
      const fromX = left + Math.floor((ox * side) / output);
      const toX = left + Math.max(Math.floor(((ox + 1) * side) / output), Math.floor((ox * side) / output) + 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          const at = base + x * perColumn + y * perRow;
          const alpha = raster.rgba[at + 3] ?? 255;
          red += ((raster.rgba[at] ?? 0) * alpha + background.red * (255 - alpha)) / 255;
          green += ((raster.rgba[at + 1] ?? 0) * alpha + background.green * (255 - alpha)) / 255;
          blue += ((raster.rgba[at + 2] ?? 0) * alpha + background.blue * (255 - alpha)) / 255;
        }
      }
      const count = (toX - fromX) * (toY - fromY);
      const colour = screenColour({ red: red / count, green: green / count, blue: blue / count }, header.displayP3);
      const out = (oy * output + ox) * 4;
      pixels[out] = colour.red;
      pixels[out + 1] = colour.green;
      pixels[out + 2] = colour.blue;
    }
  }
  return jpeg.encode({ data: pixels, width: output, height: output }, DISPLAY_QUALITY).data;
}

/** The widths a display crop or demo photo is also served at, so a small tile never loads 1200 pixels. */
export const SHRINK_WIDTHS = [120, 240, 480, 800] as const;

/** A JPEG averaged down to `width` pixels wide, keeping its aspect; the bytes back unchanged if already that small. */
export function shrinkJpeg(bytes: Uint8Array, width: number): Uint8Array {
  const raster = decode(bytes, "jpeg");
  if (raster.width <= width) return bytes;
  const height = Math.max(1, Math.round((raster.height * width) / raster.width));
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let oy = 0; oy < height; oy += 1) {
    const fromY = Math.floor((oy * raster.height) / height);
    const toY = Math.max(Math.floor(((oy + 1) * raster.height) / height), fromY + 1);
    for (let ox = 0; ox < width; ox += 1) {
      const fromX = Math.floor((ox * raster.width) / width);
      const toX = Math.max(Math.floor(((ox + 1) * raster.width) / width), fromX + 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          const at = (y * raster.width + x) * 4;
          red += raster.rgba[at] ?? 0;
          green += raster.rgba[at + 1] ?? 0;
          blue += raster.rgba[at + 2] ?? 0;
        }
      }
      const count = (toX - fromX) * (toY - fromY);
      const out = (oy * width + ox) * 4;
      pixels[out] = Math.round(red / count);
      pixels[out + 1] = Math.round(green / count);
      pixels[out + 2] = Math.round(blue / count);
    }
  }
  return jpeg.encode({ data: pixels, width, height }, DISPLAY_QUALITY).data;
}

/** Decodes the photo once and takes every measurement the request asks for from the upright image. */
export function measure({ bytes, header, point, crop }: MeasureRequest): Measurement {
  const raster = decode(bytes, header.type);
  if (raster.width !== header.storedWidth || raster.height !== header.storedHeight) {
    throw new Error("the decoded photo does not match its header");
  }
  const halfWidth = Math.max(1, Math.floor(header.width / 2));
  const halfHeight = Math.max(1, Math.floor(header.height / 2));
  const x0 = Math.floor((header.width - halfWidth) / 2);
  const y0 = Math.floor((header.height - halfHeight) / 2);
  const computed = swatchOver(raster, header, { x0, y0, x1: x0 + halfWidth, y1: y0 + halfHeight });
  let sampled: string | null = null;
  if (point) {
    const column = Math.round(point.x * (header.width - 1));
    const row = Math.round(point.y * (header.height - 1));
    sampled = swatchOver(raster, header, {
      x0: Math.max(0, column - EYEDROPPER_RADIUS),
      y0: Math.max(0, row - EYEDROPPER_RADIUS),
      x1: Math.min(header.width, column + EYEDROPPER_RADIUS + 1),
      y1: Math.min(header.height, row + EYEDROPPER_RADIUS + 1),
    });
  }
  return { computed, sampled, display: crop ? displayCrop(raster, header, hexToRgb(computed)) : null };
}
