type PhotoType = { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; extension: 'jpg' | 'png' | 'webp' }

export const PHOTO_TYPE_MESSAGE = 'Use a JPEG, PNG or WebP image.'
/** How many leading bytes the type decision reads. */
export const PHOTO_SIGNATURE_BYTES = 12

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte)
}

/** The image type, decided only from the file's leading bytes. */
export function detectPhotoType(bytes: Uint8Array): PhotoType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', extension: 'jpg' }
  if (startsWith(bytes, PNG)) return { contentType: 'image/png', extension: 'png' }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  return null
}
