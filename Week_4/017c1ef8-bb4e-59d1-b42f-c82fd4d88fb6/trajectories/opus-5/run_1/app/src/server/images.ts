/**
 * Photo type is decided by content, and metadata is stripped while every pixel
 * byte is left untouched.
 */
export type PhotoType = 'image/jpeg' | 'image/png';

export function detectPhotoType(bytes: Buffer): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  return null;
}

function stripJpeg(bytes: Buffer): Buffer {
  const out: Buffer[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      out.push(bytes.subarray(i));
      return Buffer.concat(out);
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      out.push(bytes.subarray(i));
      return Buffer.concat(out);
    }
    const length = bytes.readUInt16BE(i + 2);
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return Buffer.concat(out);
}

function stripPng(bytes: Buffer): Buffer {
  const dropped = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const out: Buffer[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(i);
    const type = bytes.subarray(i + 4, i + 8).toString('latin1');
    const total = 12 + length;
    if (!dropped.has(type)) out.push(bytes.subarray(i, i + total));
    i += total;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

export function stripPhotoMetadata(bytes: Buffer, type: PhotoType): Buffer {
  return type === 'image/jpeg' ? stripJpeg(bytes) : stripPng(bytes);
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}
