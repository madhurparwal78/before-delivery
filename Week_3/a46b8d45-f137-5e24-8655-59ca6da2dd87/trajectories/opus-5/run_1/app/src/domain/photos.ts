/**
 * The one place that judges a damage photo. A file is accepted only by its leading bytes:
 * its name, its extension and the type the browser declared are all ignored.
 */

export const PHOTO_SIZE_CAP_BYTES = 8_000_000;
export const PHOTO_COUNT_MIN = 1;
export const PHOTO_COUNT_MAX = 4;

export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The detected type, or null when the leading bytes are not a JPEG, PNG or WebP. */
export function detectPhotoType(bytes: Buffer): PhotoType | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export type PhotoRefusal = 'not_a_photo' | 'too_large';

/**
 * A file that is both not a photo and over the cap is reported once, as `not_a_photo`,
 * so the type check comes first.
 */
export function refusePhoto(bytes: Buffer): PhotoRefusal | null {
  if (detectPhotoType(bytes) === null) return 'not_a_photo';
  return bytes.length > PHOTO_SIZE_CAP_BYTES ? 'too_large' : null;
}

/** A file name never reaches a storage key, and only its last part is named in a message. */
export function baseFileName(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}
