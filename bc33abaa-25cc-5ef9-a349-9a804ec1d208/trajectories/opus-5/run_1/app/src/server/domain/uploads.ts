import { ApiError, fail } from '../http/errors';

export type AssetKind = 'model' | 'texture';

export const MODEL_LIMIT_BYTES = 20_000_000;
export const TEXTURE_LIMIT_BYTES = 8_000_000;
export const MAX_TEXTURE_SIDE = 4096;

export interface UploadCandidate {
  kind: string;
  fileName: string;
  bytes: Buffer;
}

export interface AcceptedUpload {
  kind: AssetKind;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

function nameAllowed(fileName: string): boolean {
  if (fileName.length < 1 || fileName.length > 120) return false;
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return false;
  return !/[\u0000-\u001f\u007f]/.test(fileName);
}

function isBinaryGltf(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.toString('ascii', 0, 4) !== 'glTF') return false;
  if (bytes.readUInt32LE(4) !== 2) return false;
  return bytes.readUInt32LE(8) === bytes.length;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Judges the received bytes in the order set out in Business rules: name, then
 * size, then content, then texture dimensions.
 */
export function checkUpload(candidate: UploadCandidate): AcceptedUpload {
  if (candidate.kind !== 'model' && candidate.kind !== 'texture') {
    throw fail.validation({ kind: 'Must be model or texture' });
  }
  if (!nameAllowed(candidate.fileName)) {
    throw fail.validation({ file: 'File name is not allowed' });
  }
  const kind: AssetKind = candidate.kind;
  const limit = kind === 'model' ? MODEL_LIMIT_BYTES : TEXTURE_LIMIT_BYTES;
  if (candidate.bytes.length > limit) throw fail.fileTooLarge(limit);

  const lowerName = candidate.fileName.toLowerCase();
  if (kind === 'model') {
    if (!lowerName.endsWith('.glb') || !isBinaryGltf(candidate.bytes)) {
      throw fail.unsupportedType();
    }
    return {
      kind,
      fileName: candidate.fileName,
      contentType: 'model/gltf-binary',
      bytes: candidate.bytes,
    };
  }

  const png = lowerName.endsWith('.png') && isPng(candidate.bytes);
  const jpeg = (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) && isJpeg(candidate.bytes);
  if (!png && !jpeg) throw fail.unsupportedType();
  const size = png ? pngSize(candidate.bytes) : jpegSize(candidate.bytes);
  if (!size) throw fail.unsupportedType();
  if (size.width > MAX_TEXTURE_SIDE || size.height > MAX_TEXTURE_SIDE) {
    throw fail.validation({ file: 'Texture is larger than 4096 by 4096 pixels' });
  }
  return {
    kind,
    fileName: candidate.fileName,
    contentType: png ? 'image/png' : 'image/jpeg',
    bytes: candidate.bytes,
  };
}

export function checkPngBody(bytes: Buffer): ApiError | null {
  return isPng(bytes) ? null : fail.unsupportedType();
}
