/**
 * Intake photos. A photo is accepted when its first bytes say JPEG, PNG or WebP, whatever
 * its file name or declared type, and its decoded image is readable. The public copy has
 * the camera orientation applied, every metadata block removed (re-encoding writes none)
 * and its longest side at most 1600 pixels.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { MAX_PUBLIC_PHOTO_EDGE } from '../../shared/shop.js';

const require = createRequire(import.meta.url);

export type PhotoFormat = 'image/jpeg' | 'image/png' | 'image/webp';

interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Codec = {
  decode: (format: PhotoFormat, bytes: ArrayBuffer) => Promise<RawImage>;
  encode: (format: PhotoFormat, image: RawImage) => Promise<ArrayBuffer>;
  resize: (image: RawImage, width: number, height: number) => Promise<RawImage>;
};

let codecPromise: Promise<Codec> | null = null;

async function compile(specifier: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await readFile(require.resolve(specifier)));
}

async function loadCodec(): Promise<Codec> {
  const [jpegDecode, jpegEncode, pngDecode, pngEncode, webpDecode, webpEncode, resizeModule] =
    await Promise.all([
      import('@jsquash/jpeg/decode.js'),
      import('@jsquash/jpeg/encode.js'),
      import('@jsquash/png/decode.js'),
      import('@jsquash/png/encode.js'),
      import('@jsquash/webp/decode.js'),
      import('@jsquash/webp/encode.js'),
      import('@jsquash/resize'),
    ]);

  const pngWasm = await compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
  await Promise.all([
    jpegDecode.init(await compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
    jpegEncode.init(await compile('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
    pngDecode.init(pngWasm),
    pngEncode.init(pngWasm),
    webpDecode.init(await compile('@jsquash/webp/codec/dec/webp_dec.wasm')),
    webpEncode.init(await compile('@jsquash/webp/codec/enc/webp_enc.wasm')),
    resizeModule.initResize(await compile('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')),
  ]);

  return {
    decode: async (format, bytes) => {
      switch (format) {
        case 'image/jpeg':
          return jpegDecode.default(bytes) as Promise<RawImage>;
        case 'image/png':
          return pngDecode.default(bytes) as Promise<RawImage>;
        case 'image/webp':
          return webpDecode.default(bytes) as Promise<RawImage>;
      }
    },
    encode: async (format, image) => {
      switch (format) {
        case 'image/jpeg':
          return jpegEncode.default(image as ImageData, { quality: 82 });
        case 'image/png':
          return pngEncode.default(image as ImageData);
        case 'image/webp':
          return webpEncode.default(image as ImageData, { quality: 82 });
      }
    },
    resize: async (image, width, height) =>
      resizeModule.default(image as ImageData, { width, height }) as Promise<RawImage>,
  };
}

function codec(): Promise<Codec> {
  codecPromise ??= loadCodec();
  return codecPromise;
}

/** The content a photo's first bytes say it is, whatever its file name or declared type. */
export function sniffFormat(bytes: Buffer): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function orientationFromExif(exif: Buffer): number {
  if (exif.length < 8) return 1;
  const little = exif.subarray(0, 2).toString('latin1') === 'II';
  const readU16 = (at: number): number =>
    little ? exif.readUInt16LE(at) : exif.readUInt16BE(at);
  const readU32 = (at: number): number =>
    little ? exif.readUInt32LE(at) : exif.readUInt32BE(at);
  if (readU16(2) !== 42) return 1;
  const ifdOffset = readU32(4);
  if (ifdOffset + 2 > exif.length) return 1;
  const entries = readU16(ifdOffset);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > exif.length) break;
    if (readU16(entry) === 0x0112) {
      const value = readU16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** The camera orientation a photo's container declares, 1 when it declares none. */
export function readOrientation(bytes: Buffer, format: PhotoFormat): number {
  const marker = Buffer.from('Exif\0\0', 'latin1');
  if (format === 'image/jpeg') {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) break;
      const kind = bytes[at + 1] as number;
      if (kind === 0xd8 || kind === 0x01 || (kind >= 0xd0 && kind <= 0xd7)) {
        at += 2;
        continue;
      }
      if (kind === 0xda) break;
      const length = bytes.readUInt16BE(at + 2);
      if (kind === 0xe1 && bytes.subarray(at + 4, at + 10).equals(marker)) {
        return orientationFromExif(bytes.subarray(at + 10, at + 2 + length));
      }
      at += 2 + length;
    }
    return 1;
  }
  if (format === 'image/png') {
    let at = 8;
    while (at + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(at);
      const type = bytes.subarray(at + 4, at + 8).toString('latin1');
      if (type === 'eXIf') return orientationFromExif(bytes.subarray(at + 8, at + 8 + length));
      if (type === 'IDAT' || type === 'IEND') break;
      at += 12 + length;
    }
    return 1;
  }
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = bytes.subarray(at, at + 4).toString('latin1');
    const length = bytes.readUInt32LE(at + 4);
    if (type === 'EXIF') {
      const chunk = bytes.subarray(at + 8, at + 8 + length);
      return orientationFromExif(chunk.subarray(0, 6).equals(marker) ? chunk.subarray(6) : chunk);
    }
    at += 8 + length + (length % 2);
  }
  return 1;
}

function applyOrientation(image: RawImage, orientation: number): RawImage {
  if (orientation === 1) return image;
  const { width: sourceWidth, height: sourceHeight, data: source } = image;
  const swaps = orientation >= 5;
  const width = swaps ? sourceHeight : sourceWidth;
  const height = swaps ? sourceWidth : sourceHeight;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sourceX: number;
      let sourceY: number;
      switch (orientation) {
        case 2:
          sourceX = sourceWidth - 1 - x;
          sourceY = y;
          break;
        case 3:
          sourceX = sourceWidth - 1 - x;
          sourceY = sourceHeight - 1 - y;
          break;
        case 4:
          sourceX = x;
          sourceY = sourceHeight - 1 - y;
          break;
        case 5:
          sourceX = y;
          sourceY = x;
          break;
        case 6:
          sourceX = y;
          sourceY = sourceHeight - 1 - x;
          break;
        case 7:
          sourceX = sourceWidth - 1 - y;
          sourceY = sourceHeight - 1 - x;
          break;
        default:
          sourceX = sourceWidth - 1 - y;
          sourceY = x;
          break;
      }
      const to = (y * width + x) * 4;
      const from = (sourceY * sourceWidth + sourceX) * 4;
      data[to] = source[from] as number;
      data[to + 1] = source[from + 1] as number;
      data[to + 2] = source[from + 2] as number;
      data[to + 3] = source[from + 3] as number;
    }
  }
  return { data, width, height };
}

/** The bytes as an ArrayBuffer of their own, since a Buffer may view a shared pool. */
function standaloneBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class UnreadablePhoto extends Error {
  constructor(cause?: unknown) {
    super('The photo could not be decoded');
    this.name = 'UnreadablePhoto';
    this.cause = cause;
  }
}

export interface PublicCopy {
  bytes: Buffer;
  width: number;
  height: number;
}

export async function makePublicCopy(original: Buffer, format: PhotoFormat): Promise<PublicCopy> {
  const engine = await codec();
  let decoded: RawImage;
  try {
    decoded = await engine.decode(format, standaloneBuffer(original));
  } catch (error) {
    throw new UnreadablePhoto(error);
  }
  if (decoded.width < 1 || decoded.height < 1) throw new UnreadablePhoto();

  const oriented = applyOrientation(decoded, readOrientation(original, format));
  const longest = Math.max(oriented.width, oriented.height);
  const scaled =
    longest <= MAX_PUBLIC_PHOTO_EDGE
      ? oriented
      : await engine.resize(
          oriented,
          Math.max(1, Math.round((oriented.width * MAX_PUBLIC_PHOTO_EDGE) / longest)),
          Math.max(1, Math.round((oriented.height * MAX_PUBLIC_PHOTO_EDGE) / longest)),
        );

  const encoded = await engine.encode(format, scaled);
  return { bytes: Buffer.from(encoded), width: scaled.width, height: scaled.height };
}
