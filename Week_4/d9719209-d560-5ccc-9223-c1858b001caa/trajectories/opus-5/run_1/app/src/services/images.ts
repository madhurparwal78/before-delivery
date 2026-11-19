import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { config } from '../core/config.js';

const require = createRequire(import.meta.url);

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface DecodeModule {
  init(module: WebAssembly.Module): Promise<unknown>;
  default(bytes: ArrayBufferLike): Promise<RawImage>;
}

interface EncodeModule {
  init(module: WebAssembly.Module): Promise<unknown>;
  default(image: RawImage, options?: { quality?: number }): Promise<ArrayBuffer>;
}

async function compile(path: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(readFileSync(require.resolve(path)));
}

let codecs: Promise<{ jpeg: DecodeModule; png: DecodeModule; webp: DecodeModule; webpEncode: EncodeModule }> | null =
  null;

function loadCodecs() {
  codecs ??= (async () => {
    const [jpeg, png, webp, webpEncode] = (await Promise.all([
      import('@jsquash/jpeg/decode.js'),
      import('@jsquash/png/decode.js'),
      import('@jsquash/webp/decode.js'),
      import('@jsquash/webp/encode.js'),
    ])) as unknown as [DecodeModule, DecodeModule, DecodeModule, EncodeModule];
    await jpeg.init(await compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'));
    await png.init(await compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'));
    await webp.init(await compile('@jsquash/webp/codec/dec/webp_dec.wasm'));
    await webpEncode.init(await compile('@jsquash/webp/codec/enc/webp_enc_simd.wasm'));
    return { jpeg, png, webp, webpEncode };
  })();
  return codecs;
}

/** Content sniffing by magic bytes, whatever the file is named or declares. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Reads the EXIF orientation tag out of a JPEG's APP1 segment; 1 when there is none. */
export function exifOrientation(bytes: Uint8Array): number {
  if (sniffFormat(bytes) !== 'jpeg') return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const size = view.getUint16(offset + 2, false);
    if (marker === 0xe1) {
      const segment = offset + 4;
      const header = Buffer.from(bytes.buffer, bytes.byteOffset + segment, 6).toString('latin1');
      if (header === 'Exif\0\0') {
        const tiff = segment + 6;
        const little = view.getUint16(tiff, false) === 0x4949;
        const ifdOffset = view.getUint32(tiff + 4, little);
        const entries = view.getUint16(tiff + ifdOffset, little);
        for (let index = 0; index < entries; index += 1) {
          const entry = tiff + ifdOffset + 2 + index * 12;
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
    }
    if (marker === 0xda) break;
    offset += 2 + size;
  }
  return 1;
}

function applyOrientation(image: RawImage, orientation: number): RawImage {
  if (orientation === 1) return image;
  const { width, height, data } = image;
  const swapped = orientation >= 5;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const output = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let targetX = x;
      let targetY = y;
      switch (orientation) {
        case 2:
          targetX = width - 1 - x;
          break;
        case 3:
          targetX = width - 1 - x;
          targetY = height - 1 - y;
          break;
        case 4:
          targetY = height - 1 - y;
          break;
        case 5:
          targetX = y;
          targetY = x;
          break;
        case 6:
          targetX = height - 1 - y;
          targetY = x;
          break;
        case 7:
          targetX = height - 1 - y;
          targetY = width - 1 - x;
          break;
        case 8:
          targetX = y;
          targetY = width - 1 - x;
          break;
        default:
          break;
      }
      const from = (y * width + x) * 4;
      const to = (targetY * outWidth + targetX) * 4;
      output[to] = data[from];
      output[to + 1] = data[from + 1];
      output[to + 2] = data[from + 2];
      output[to + 3] = data[from + 3];
    }
  }
  return { data: output, width: outWidth, height: outHeight };
}

/** Box-filter downscale; images are never upscaled. */
function resize(image: RawImage, targetWidth: number): RawImage {
  if (targetWidth >= image.width) return image;
  const scale = image.width / targetWidth;
  const targetHeight = Math.max(1, Math.round(image.height / scale));
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceTop = Math.floor((y * image.height) / targetHeight);
    const sourceBottom = Math.max(sourceTop + 1, Math.floor(((y + 1) * image.height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceLeft = Math.floor((x * image.width) / targetWidth);
      const sourceRight = Math.max(sourceLeft + 1, Math.floor(((x + 1) * image.width) / targetWidth));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;
      for (let sy = sourceTop; sy < sourceBottom; sy += 1) {
        for (let sx = sourceLeft; sx < sourceRight; sx += 1) {
          const index = (sy * image.width + sx) * 4;
          red += image.data[index];
          green += image.data[index + 1];
          blue += image.data[index + 2];
          alpha += image.data[index + 3];
          samples += 1;
        }
      }
      const target = (y * targetWidth + x) * 4;
      output[target] = red / samples;
      output[target + 1] = green / samples;
      output[target + 2] = blue / samples;
      output[target + 3] = alpha / samples;
    }
  }
  return { data: output, width: targetWidth, height: targetHeight };
}

export interface Variant {
  slot: 'original' | '320' | '640' | '1080';
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface ProcessedImage {
  width: number;
  height: number;
  variants: Variant[];
}

export class UnsupportedImage extends Error {
  readonly reason: 'type' | 'pixels';

  constructor(reason: 'type' | 'pixels') {
    super(reason === 'type' ? 'Unsupported image type' : 'Too many pixels');
    this.name = 'UnsupportedImage';
    this.reason = reason;
  }
}

/**
 * Applies the EXIF orientation and re-encodes to WebP from raw pixels, so no EXIF, XMP or IPTC
 * metadata can survive into any stored variant.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  const format = sniffFormat(bytes);
  if (!format) throw new UnsupportedImage('type');

  const declared = readDimensions(bytes);
  if (declared && declared.width * declared.height > config.maxPixels) throw new UnsupportedImage('pixels');

  const { jpeg, png, webp, webpEncode } = await loadCodecs();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoder = format === 'jpeg' ? jpeg : format === 'png' ? png : webp;
  let decoded: RawImage;
  try {
    decoded = await decoder.default(buffer);
  } catch {
    throw new UnsupportedImage('type');
  }

  const oriented = applyOrientation(decoded, exifOrientation(bytes));
  const variants: Variant[] = [];
  const encode = async (image: RawImage, slot: Variant['slot']) => {
    const encoded = await webpEncode.default(image, { quality: 82 });
    variants.push({ slot, width: image.width, height: image.height, bytes: new Uint8Array(encoded) });
  };

  await encode(oriented, 'original');
  for (const slot of config.imageSlots) {
    await encode(resize(oriented, slot), String(slot) as Variant['slot']);
  }

  return { width: oriented.width, height: oriented.height, variants };
}

/** Reads width and height from the container header, before any pixels are decoded. */
export function readDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const format = sniffFormat(bytes);
  if (!format) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'png') {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  if (format === 'jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const size = view.getUint16(offset + 2, false);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) };
      }
      offset += 2 + size;
    }
    return null;
  }
  const chunk = Buffer.from(bytes.buffer, bytes.byteOffset + 12, 4).toString('latin1');
  if (chunk === 'VP8X') {
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
