// Intake photos: what their bytes say they are, and the cleaned public copy.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import decodeWebp, { init as initWebpDecode } from "@jsquash/webp/decode.js";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode.js";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { simd } from "wasm-feature-detect";

const LONGEST_SIDE = 1600;
const JPEG_QUALITY = 88;
const MAX_MEGAPIXELS = 100;

export class NotAPhoto extends Error {}

type PhotoType = "image/jpeg" | "image/png" | "image/webp";

export function photoTypeOf(bytes: Buffer): PhotoType | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The camera orientation (1 to 8) inside a TIFF block, or 1 when it has none. */
function tiffOrientation(tiff: Buffer): number {
  const order = tiff.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return 1;
  const short = (at: number): number => (order === "II" ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const long = (at: number): number => (order === "II" ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (tiff.length < 14) return 1;
  const directory = long(4);
  if (directory + 2 > tiff.length) return 1;
  const entries = short(directory);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (short(entry) === 0x0112) {
      const value = short(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function jpegOrientation(bytes: Buffer): number {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda) return 1;
    const length = bytes.readUInt16BE(at + 2);
    if (marker === 0xe1 && bytes.subarray(at + 4, at + 10).toString("latin1") === "Exif\0\0") {
      return tiffOrientation(bytes.subarray(at + 10, at + 2 + length));
    }
    at += 2 + length;
  }
  return 1;
}

function pngOrientation(bytes: Buffer): number {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    if (bytes.subarray(at + 4, at + 8).toString("latin1") === "eXIf") return tiffOrientation(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return 1;
}

function webpOrientation(bytes: Buffer): number {
  let at = 12;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(at + 4);
    if (bytes.subarray(at, at + 4).toString("latin1") === "EXIF") {
      const block = bytes.subarray(at + 8, at + 8 + length);
      return tiffOrientation(block.subarray(0, 6).toString("latin1") === "Exif\0\0" ? block.subarray(6) : block);
    }
    at += 8 + length + (length % 2);
  }
  return 1;
}

/** Where the pixel at x, y lands under a camera orientation from 2 to 8. */
function placed(orientation: number, x: number, y: number, width: number, height: number): [number, number] {
  switch (orientation) {
    case 2:
      return [width - 1 - x, y];
    case 3:
      return [width - 1 - x, height - 1 - y];
    case 4:
      return [x, height - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [height - 1 - y, x];
    case 7:
      return [height - 1 - y, width - 1 - x];
    default:
      return [y, width - 1 - x];
  }
}

/** Applies a camera orientation so the picture stands the way it was taken. */
function oriented({ width, height, data }: Pixels, orientation: number): Pixels {
  if (orientation === 1) return { width, height, data };
  const swaps = orientation >= 5;
  const outWidth = swaps ? height : width;
  const outHeight = swaps ? width : height;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [outX, outY] = placed(orientation, x, y, width, height);
      out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (outY * outWidth + outX) * 4);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

/** Box-filters a picture down until its longest side fits. */
function fitted({ width, height, data }: Pixels): Pixels {
  const longest = Math.max(width, height);
  if (longest <= LONGEST_SIDE) return { width, height, data };
  const outWidth = Math.max(1, Math.round((width * LONGEST_SIDE) / longest));
  const outHeight = Math.max(1, Math.round((height * LONGEST_SIDE) / longest));
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let outY = 0; outY < outHeight; outY += 1) {
    const fromY = Math.floor((outY * height) / outHeight);
    const toY = Math.max(fromY + 1, Math.floor(((outY + 1) * height) / outHeight));
    for (let outX = 0; outX < outWidth; outX += 1) {
      const fromX = Math.floor((outX * width) / outWidth);
      const toX = Math.max(fromX + 1, Math.floor(((outX + 1) * width) / outWidth));
      const sums = [0, 0, 0, 0];
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += data[(y * width + x) * 4 + channel];
        }
      }
      const samples = (toY - fromY) * (toX - fromX);
      for (let channel = 0; channel < 4; channel += 1) out[(outY * outWidth + outX) * 4 + channel] = Math.round(sums[channel] / samples);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

// The WebP codec builds ImageData objects, which Node does not have.
if (!("ImageData" in globalThis)) {
  Object.defineProperty(globalThis, "ImageData", {
    value: class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  });
}

const require = createRequire(import.meta.url);
const codec = async (path: string): Promise<WebAssembly.Module> =>
  WebAssembly.compile(await readFile(require.resolve("@jsquash/webp/decode.js").replace("decode.js", path)));

let webpReady: Promise<void> | null = null;

function loadWebp(): Promise<void> {
  webpReady ??= (async () => {
    await initWebpDecode(await codec("codec/dec/webp_dec.wasm"));
    await initWebpEncode(await codec((await simd()) ? "codec/enc/webp_enc_simd.wasm" : "codec/enc/webp_enc.wasm"));
  })();
  return webpReady;
}

function arrayBufferOf(bytes: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function decoded(bytes: Buffer, type: PhotoType): Promise<Pixels> {
  try {
    if (type === "image/jpeg") {
      const { width, height, data } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS });
      return { width, height, data };
    }
    if (type === "image/png") {
      const { width, height, data } = PNG.sync.read(bytes);
      return { width, height, data };
    }
    await loadWebp();
    const { width, height, data } = await decodeWebp(arrayBufferOf(bytes));
    return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch {
    throw new NotAPhoto();
  }
}

async function encoded(pixels: Pixels, type: PhotoType): Promise<Buffer> {
  if (type === "image/jpeg") return jpeg.encode({ ...pixels, data: Buffer.from(pixels.data) }, JPEG_QUALITY).data;
  if (type === "image/png") return PNG.sync.write(Object.assign(new PNG({ width: pixels.width, height: pixels.height }), { data: Buffer.from(pixels.data) }));
  await loadWebp();
  const data = new Uint8ClampedArray(pixels.data);
  return Buffer.from(await encodeWebp({ data, width: pixels.width, height: pixels.height, colorSpace: "srgb" }));
}

interface PublicCopy {
  bytes: Buffer;
  width: number;
  height: number;
}

/** Re-encoding from pixels is what removes every metadata block: nothing but the picture reaches the new file. */
export async function publicCopyOf(bytes: Buffer, type: PhotoType): Promise<PublicCopy> {
  const orientation = { "image/jpeg": jpegOrientation, "image/png": pngOrientation, "image/webp": webpOrientation }[type](bytes);
  const pixels = fitted(oriented(await decoded(bytes, type), orientation));
  return { bytes: await encoded(pixels, type), width: pixels.width, height: pixels.height };
}
