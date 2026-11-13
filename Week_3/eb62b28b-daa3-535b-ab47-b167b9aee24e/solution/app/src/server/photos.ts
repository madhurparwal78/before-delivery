// The staff copy of a photo: orientation applied to the pixels, re-encoded, with every metadata block gone.

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

const JPEG_QUALITY = 90;

function orientationInTiff(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const start = u32(4);
  if (start + 2 > tiff.length) return 1;
  const count = u16(start);
  for (let index = 0; index < count; index += 1) {
    const entry = start + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

function jpegOrientation(file: Buffer): number {
  let at = 2;
  while (at + 4 <= file.length && file[at] === 0xff) {
    const marker = file[at + 1];
    const length = file.readUInt16BE(at + 2);
    if (marker === 0xda) return 1;
    if (marker === 0xe1 && file.toString("latin1", at + 4, at + 10) === "Exif\0\0") {
      return orientationInTiff(file.subarray(at + 10, at + 2 + length));
    }
    at += 2 + length;
  }
  return 1;
}

function pngOrientation(file: Buffer): number {
  let at = 8;
  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "eXIf") {
      return orientationInTiff(file.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  return 1;
}

// Orientations 5 to 8 swap width and height; each maps a source pixel to its upright place.
function upright(source: Raster, orientation: number): Raster {
  const { width, height } = source;
  const swaps = orientation >= 5;
  const outWidth = swaps ? height : width;
  const outHeight = swaps ? width : height;
  const data = new Uint8Array(outWidth * outHeight * 4);
  const place: Record<number, (x: number, y: number) => [number, number]> = {
    2: (x, y) => [width - 1 - x, y],
    3: (x, y) => [width - 1 - x, height - 1 - y],
    4: (x, y) => [x, height - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y) => [height - 1 - y, x],
    7: (x, y) => [height - 1 - y, width - 1 - x],
    8: (x, y) => [y, width - 1 - x],
  };
  const move = place[orientation];
  if (!move) return source;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [outX, outY] = move(x, y);
      const from = (y * width + x) * 4;
      const to = (outY * outWidth + outX) * 4;
      data.set(source.data.subarray(from, from + 4), to);
    }
  }
  return { width: outWidth, height: outHeight, data };
}

export function cleanJpeg(file: Buffer): Buffer {
  const decoded = jpeg.decode(file, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
  const turned = upright(decoded, jpegOrientation(file));
  return Buffer.from(jpeg.encode({ ...turned, data: Buffer.from(turned.data) }, JPEG_QUALITY).data);
}

export function cleanPng(file: Buffer): Buffer {
  const decoded = PNG.sync.read(file);
  const turned = upright(decoded, pngOrientation(file));
  const out = new PNG({ width: turned.width, height: turned.height });
  out.data = Buffer.from(turned.data);
  return PNG.sync.write(out);
}
