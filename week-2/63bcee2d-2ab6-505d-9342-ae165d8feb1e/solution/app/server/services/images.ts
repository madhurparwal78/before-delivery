import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// Site photos: camera orientation applied to the pixels and every EXIF field (GPS included) dropped by
// re-encoding (brief: Site photos). Also the seed's procedural 1600 by 1000 render and photo.

type ImageKind = "png" | "jpg";

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

/** EXIF orientation (1-8) from a TIFF block, or 1. */
function tiffOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
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
    const length = data.readUInt16BE(at + 2);
    if (marker === 0xe1 && data.toString("latin1", at + 4, at + 10) === "Exif\0\0") {
      return tiffOrientation(data.subarray(at + 10, at + 2 + length));
    }
    if (marker === 0xda) break;
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
    if (type === "IDAT") break;
    at += 12 + length;
  }
  return 1;
}

function orient(source: Pixels, orientation: number): Pixels {
  if (orientation === 1) return source;
  const { width: w, height: h, data } = source;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number, sy: number;
      switch (orientation) {
        case 2: [sx, sy] = [w - 1 - x, y]; break;
        case 3: [sx, sy] = [w - 1 - x, h - 1 - y]; break;
        case 4: [sx, sy] = [x, h - 1 - y]; break;
        case 5: [sx, sy] = [y, x]; break;
        case 6: [sx, sy] = [y, h - 1 - x]; break;
        case 7: [sx, sy] = [w - 1 - y, h - 1 - x]; break;
        default: [sx, sy] = [w - 1 - y, x]; break;
      }
      const from = (sy * w + sx) * 4;
      out.set(data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data: out };
}

/** Decodes, applies the orientation and re-encodes with no metadata. */
export function cleanPhoto(data: Buffer, kind: ImageKind): { data: Buffer; width: number; height: number } {
  if (kind === "jpg") {
    const decoded = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
    const pixels = orient({ width: decoded.width, height: decoded.height, data: decoded.data }, jpegOrientation(data));
    const encoded = jpeg.encode({ width: pixels.width, height: pixels.height, data: Buffer.from(pixels.data) }, 90);
    return { data: Buffer.from(encoded.data), width: pixels.width, height: pixels.height };
  }
  const decoded = PNG.sync.read(data);
  const pixels = orient({ width: decoded.width, height: decoded.height, data: decoded.data }, pngOrientation(data));
  return { data: encodePng(pixels), width: pixels.width, height: pixels.height };
}

function encodePng(pixels: Pixels): Buffer {
  const png = new PNG({ width: pixels.width, height: pixels.height });
  png.data = Buffer.from(pixels.data);
  return PNG.sync.write(png);
}

// Procedural seed imagery: the VP-01 entrance elevation as a line-drawn render and as a site photo.

const WIDTH = 1600;
const HEIGHT = 1000;
type Rgb = [number, number, number];

class Canvas {
  readonly data = new Uint8Array(WIDTH * HEIGHT * 4);

  fill(x0: number, y0: number, x1: number, y1: number, colour: (x: number, y: number) => Rgb): void {
    for (let y = Math.max(0, y0); y < Math.min(HEIGHT, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(WIDTH, x1); x++) {
        const [r, g, b] = colour(x, y);
        const at = (y * WIDTH + x) * 4;
        this.data[at] = r;
        this.data[at + 1] = g;
        this.data[at + 2] = b;
        this.data[at + 3] = 255;
      }
    }
  }

  rect(x0: number, y0: number, x1: number, y1: number, rgb: Rgb): void {
    this.fill(x0, y0, x1, y1, () => rgb);
  }

  frame(x0: number, y0: number, x1: number, y1: number, weight: number, rgb: Rgb): void {
    this.rect(x0, y0, x1, y0 + weight, rgb);
    this.rect(x0, y1 - weight, x1, y1, rgb);
    this.rect(x0, y0, x0 + weight, y1, rgb);
    this.rect(x1 - weight, y0, x1, y1, rgb);
  }

  png(): Buffer {
    return encodePng({ width: WIDTH, height: HEIGHT, data: this.data });
  }
}

/** The shopfront: fascia, three glazed bays split by mullions, a door, a counter and the floor line. */
function elevation(canvas: Canvas, line: Rgb, weight: number, shade?: { glass: Rgb; fascia: Rgb; counter: Rgb }): void {
  if (shade) {
    canvas.rect(160, 120, 1440, 250, shade.fascia);
    canvas.rect(200, 290, 1400, 860, shade.glass);
    canvas.rect(620, 640, 1180, 860, shade.counter);
  }
  canvas.frame(160, 120, 1440, 250, weight, line);
  canvas.frame(160, 250, 1440, 880, weight, line);
  canvas.frame(200, 290, 1400, 860, weight, line);
  for (const x of [520, 860, 1180]) canvas.rect(x - weight, 290, x + weight, 860, line);
  canvas.frame(880, 330, 1160, 860, weight, line);
  canvas.frame(620, 640, 860, 860, weight, line);
  canvas.rect(0, 880, WIDTH, 880 + weight * 2, line);
  for (let x = 300; x < 1300; x += 120) canvas.rect(x, 170, x + 60, 170 + weight, line);
}

/** The five palette roles (DESIGN.md): the drawn seed render and site photo carry no other hue. */
const PLASTER: Rgb = [239, 235, 226];
const INK: Rgb = [25, 26, 23];
const GREEN_BLACK: Rgb = [31, 33, 30];
const OXIDE: Rgb = [182, 70, 42];
const SAGE: Rgb = [95, 107, 85];

/** `a` blended with `b`, `share` of the way towards `b`, with a little photographic grain. */
function blend(a: Rgb, b: Rgb, share: number, grain = 0): Rgb {
  return a.map((v, i) => Math.round(v + (b[i] - v) * share) + grain) as Rgb;
}

export function seedRender(): Buffer {
  const canvas = new Canvas();
  canvas.rect(0, 0, WIDTH, HEIGHT, PLASTER);
  for (let x = 0; x < WIDTH; x += 80) canvas.rect(x, 0, x + 1, HEIGHT, blend(PLASTER, INK, 0.08));
  for (let y = 0; y < HEIGHT; y += 80) canvas.rect(0, y, WIDTH, y + 1, blend(PLASTER, INK, 0.08));
  elevation(canvas, INK, 3);
  return canvas.png();
}

export function seedPhoto(): Buffer {
  const canvas = new Canvas();
  canvas.fill(0, 0, WIDTH, HEIGHT, (x, y) => blend(PLASTER, INK, 0.18 + (y / HEIGHT) * 0.24, ((x * 7919 + y * 104729) % 23) - 11));
  canvas.fill(0, 880, WIDTH, HEIGHT, (x, y) => blend(PLASTER, INK, 0.55, ((x * 31 + y * 17) % 13) - 6));
  elevation(canvas, blend(INK, PLASTER, 0.12), 6,
    { glass: blend(GREEN_BLACK, SAGE, 0.45), fascia: SAGE, counter: blend(OXIDE, PLASTER, 0.3) });
  return canvas.png();
}
