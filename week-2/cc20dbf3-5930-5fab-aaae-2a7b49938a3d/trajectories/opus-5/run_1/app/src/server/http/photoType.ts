/** Photo type is judged only by the file's first bytes. */
export interface PhotoType {
  readonly contentType: string;
  readonly extension: 'jpg' | 'png' | 'webp';
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectPhotoType(bytes: Buffer): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}
