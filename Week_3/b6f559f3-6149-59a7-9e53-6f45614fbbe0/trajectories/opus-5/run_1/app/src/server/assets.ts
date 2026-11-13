import { MSG, copy } from '../shared/messages';
import { parseSvgOutline } from '../shared/extrusion';
import { parseGltf } from '../shared/gltf';
import type { GltfModel } from '../shared/gltf';
import type { Outline } from '../shared/extrusion';
import { config } from './config';

export interface ImageInfo {
  width: number;
  height: number;
}

function pngSize(bytes: Buffer): ImageInfo | null {
  if (bytes.byteLength < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): ImageInfo | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Buffer): ImageInfo | null {
  if (bytes.byteLength < 30) return null;
  if (bytes.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  if (bytes.slice(8, 12).toString('ascii') !== 'WEBP') return null;
  const format = bytes.slice(12, 16).toString('ascii');
  if (format === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (format === 'VP8 ') {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (format === 'VP8L') {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export interface ImageCheck {
  info: ImageInfo | null;
  refusal: string | null;
}

export function checkImage(bytes: Buffer): ImageCheck {
  const info = pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
  if (!info) return { info: null, refusal: MSG.imageKind };
  if (bytes.byteLength > config.imageMaxBytes) {
    return { info: null, refusal: copy.imageTooLarge(bytes.byteLength, config.imageMaxBytes) };
  }
  if (info.width > config.imageMaxDimension || info.height > config.imageMaxDimension) {
    return {
      info: null,
      refusal: copy.imageTooBig(info.width, info.height, config.imageMaxDimension),
    };
  }
  return { info, refusal: null };
}

export interface SvgCheck {
  outline: Outline | null;
  refusal: string | null;
}

export function checkSvg(bytes: Buffer): SvgCheck {
  const result = parseSvgOutline(bytes.toString('utf8'));
  return { outline: result.outline, refusal: result.refusal };
}

export interface ModelCheck {
  model: GltfModel | null;
  refusal: string | null;
}

export function checkModel(bytes: Buffer, fileName: string): ModelCheck {
  return parseGltf(new Uint8Array(bytes), fileName, {
    maxBytes: config.modelMaxBytes,
    maxVertices: config.modelMaxVertices,
  });
}

export function contentTypeFor(kind: string, fileName: string, given: string): string {
  if (kind === 'svg') return 'image/svg+xml';
  if (kind === 'model') {
    return fileName.toLowerCase().endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json';
  }
  return given;
}
