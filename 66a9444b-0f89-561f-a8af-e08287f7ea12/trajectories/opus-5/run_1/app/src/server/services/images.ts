import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import decodeWebp, { init as initWebpDecoder } from '@jsquash/webp/decode.js';

const require = createRequire(import.meta.url);

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null;

/** Content is judged by the file's leading bytes, never by its name or declared type. */
export function sniffType(bytes: Buffer): SniffedType {
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
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

export interface RawImage {
  width: number;
  height: number;
  rgba: Buffer;
}

let webpReady: Promise<void> | null = null;

async function ensureWebpDecoder(): Promise<void> {
  webpReady ??= (async () => {
    const wasmPath = require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
    const compiled = await WebAssembly.compile(await readFile(wasmPath));
    await initWebpDecoder(compiled);
  })();
  await webpReady;
}

/** Decodes the image, so a file whose bytes merely start right is still refused. */
export async function decodeImage(bytes: Buffer, type: SniffedType): Promise<RawImage | null> {
  try {
    if (type === 'image/jpeg') {
      const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
      return {
        width: decoded.width,
        height: decoded.height,
        rgba: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      };
    }
    if (type === 'image/png') {
      const decoded = PNG.sync.read(bytes);
      return { width: decoded.width, height: decoded.height, rgba: Buffer.from(decoded.data) };
    }
    if (type === 'image/webp') {
      await ensureWebpDecoder();
      const decoded = await decodeWebp(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      return {
        width: decoded.width,
        height: decoded.height,
        rgba: Buffer.from(decoded.data.buffer as ArrayBuffer),
      };
    }
    return null;
  } catch {
    return null;
  }
}

const DISPLAY_MAX_SIDE = 1200;

function resize(image: RawImage, width: number, height: number): RawImage {
  const out = Buffer.alloc(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceTop = Math.floor(y * scaleY);
    const sourceBottom = Math.min(image.height, Math.max(sourceTop + 1, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < width; x += 1) {
      const sourceLeft = Math.floor(x * scaleX);
      const sourceRight = Math.min(image.width, Math.max(sourceLeft + 1, Math.ceil((x + 1) * scaleX)));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;
      for (let sy = sourceTop; sy < sourceBottom; sy += 1) {
        for (let sx = sourceLeft; sx < sourceRight; sx += 1) {
          const offset = (sy * image.width + sx) * 4;
          red += image.rgba[offset] as number;
          green += image.rgba[offset + 1] as number;
          blue += image.rgba[offset + 2] as number;
          alpha += image.rgba[offset + 3] as number;
          samples += 1;
        }
      }
      const target = (y * width + x) * 4;
      out[target] = Math.round(red / samples);
      out[target + 1] = Math.round(green / samples);
      out[target + 2] = Math.round(blue / samples);
      out[target + 3] = Math.round(alpha / samples);
    }
  }
  return { width, height, rgba: out };
}

/** The display copy is a JPEG whose longest side is at most 1200 pixels. */
export function renderDisplayCopy(image: RawImage): Buffer {
  const longest = Math.max(image.width, image.height);
  const scale = longest > DISPLAY_MAX_SIDE ? DISPLAY_MAX_SIDE / longest : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const scaled = scale === 1 ? image : resize(image, width, height);
  const encoded = jpeg.encode(
    { data: scaled.rgba, width: scaled.width, height: scaled.height },
    82,
  );
  return Buffer.from(encoded.data);
}

const NAME_LIMIT = 200;

/** File names may not travel outside their prefix or hide control characters. */
export function fileNameAllowed(name: string): boolean {
  if (name.length === 0 || name.length > NAME_LIMIT) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
