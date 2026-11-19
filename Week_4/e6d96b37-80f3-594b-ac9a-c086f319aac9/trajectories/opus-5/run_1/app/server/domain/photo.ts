import { limits } from '../config.ts';
import { fieldCopy } from '../http/errors.ts';

/**
 * Intake and arrival photographs are judged by their content, never by their
 * name or declared type. Dimensions are read from the file header, so a highly
 * compressed image declaring huge dimensions is refused without being expanded.
 */

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

export interface PhotoShape {
  format: PhotoFormat;
  width: number;
  height: number;
}

export const extensionOf: Record<PhotoFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

export const contentTypeOf: Record<PhotoFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const XML_OR_SVG = /^\s*(?:<\?xml|<!DOCTYPE\s+svg|<svg[\s>])/i;

function isSvgOrXml(bytes: Buffer): boolean {
  // Only the leading bytes matter; an SVG or XML document declares itself there.
  const head = bytes.subarray(0, 512).toString('utf8');
  return XML_OR_SVG.test(head);
}

function readPngShape(bytes: Buffer): PhotoShape | null {
  if (bytes.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegShape(bytes: Buffer): PhotoShape | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    // Every start-of-frame marker carries the frame's dimensions.
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        format: 'jpeg',
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    }
    at += 2 + length;
  }
  return null;
}

function readWebpShape(bytes: Buffer): PhotoShape | null {
  if (bytes.length < 30) return null;
  if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF') return null;
  if (bytes.subarray(8, 12).toString('latin1') !== 'WEBP') return null;
  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') {
    return {
      format: 'webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { format: 'webp', width, height };
  }
  return null;
}

export type PhotoRefusal =
  | 'svg'
  | 'type'
  | 'bytes'
  | 'edge'
  | 'pixels';

export interface PhotoJudgement {
  shape: PhotoShape | null;
  refusal: PhotoRefusal | null;
}

/**
 * Judges one uploaded photograph. The byte limit is reported separately because
 * it is answered with the step-6 413 rather than a 422.
 */
export function judgePhoto(bytes: Buffer): PhotoJudgement {
  if (isSvgOrXml(bytes)) return { shape: null, refusal: 'svg' };

  const shape = readPngShape(bytes) ?? readJpegShape(bytes) ?? readWebpShape(bytes);
  if (!shape) return { shape: null, refusal: 'type' };

  if (bytes.length > limits.uploadMaxBytes) return { shape, refusal: 'bytes' };

  const longEdge = Math.max(shape.width, shape.height);
  if (longEdge < limits.photoMinEdgePx || longEdge > limits.photoMaxEdgePx) {
    return { shape, refusal: 'edge' };
  }
  if (shape.width * shape.height > limits.photoMaxPixels) {
    return { shape, refusal: 'pixels' };
  }
  return { shape, refusal: null };
}

/** The field copy for a refusal, taken from the feedback registry. */
export function refusalCopy(refusal: PhotoRefusal): string {
  switch (refusal) {
    case 'svg':
      return fieldCopy.photoSvg;
    case 'type':
      return fieldCopy.photoType;
    case 'bytes':
      return fieldCopy.photoBytes;
    case 'edge':
      return fieldCopy.photoEdge;
    case 'pixels':
      return fieldCopy.photoPixels;
  }
}
